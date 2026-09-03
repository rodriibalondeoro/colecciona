import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";
import { getStripe } from "@/lib/stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) return NextResponse.json({ error: authError }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`checkout:${ip}`, { limit: 3, windowMs: 60000 });
    if (!rl.allowed) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

    const { productIds, shippingMethod, shippingAddress } = await req.json();

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: "No hay productos seleccionados" }, { status: 400 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe no configurado. Checkout no disponible." }, { status: 503 });
    }

    const supabase = createClient(url, key);
    const uniqueIds = [...new Set(productIds)];

    // 1. Reserve products via RPC
    const reservedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: reserveError } = await supabase
      .rpc("reserve_products_for_checkout", {
        p_product_ids: uniqueIds,
        p_buyer_id: user.id,
        p_reserved_until: reservedUntil,
      });

    if (reserveError) {
      return NextResponse.json({ error: "Uno o más productos ya no están disponibles" }, { status: 409 });
    }

    // 2. Create order via RPC
    const { data: orderResult, error: orderError } = await supabase
      .rpc("create_checkout_order", {
        p_product_ids: uniqueIds,
        p_shipping_method: shippingMethod || "standard",
        p_shipping_address: shippingAddress || "",
      });

    if (orderError || !orderResult) {
      return NextResponse.json({ error: "Error creando el pedido" }, { status: 500 });
    }

    const orderId = orderResult.order_id;
    const totalCents = Math.round(orderResult.total * 100);

    // 3. Create Stripe PaymentIntent
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "eur",
        payment_method_types: ["card"],
        capture_method: "manual",
        metadata: { orderId, buyerId: user.id, productIds: uniqueIds.join(",") },
      });
    } catch (stripeError) {
      console.error("[Checkout] Stripe error:", stripeError);
      // Rollback via RPC — releases products + cancels order
      await supabase.rpc("rollback_checkout", { p_order_id: orderId });
      return NextResponse.json({ error: "Error al procesar el pago" }, { status: 500 });
    }

    // 4. Link payment intent to order
    // RACE WINDOW: Between PI creation (step 3) and this update, a webhook could arrive
    // with order still in PENDING status. confirm_payment would fail ("not PAYMENT_PROCESSING").
    // This is safe: Stripe retries webhooks with exponential backoff (up to 3 days).
    // By the next retry, order will be in PAYMENT_PROCESSING.
    await supabase
      .from("orders")
      .update({
        payment_intent_id: paymentIntent.id,
        status: "PAYMENT_PROCESSING",
        payment_processing_started_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    return NextResponse.json({
      orderId,
      clientSecret: paymentIntent.client_secret,
      amount: totalCents,
    });
  } catch (error) {
    console.error("[Checkout] Error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
