import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

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
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const supabase = createClient(url, key);

    // Deduplicate
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

    // 2. Create order via RPC (server-calculates all prices)
    const { data: orderResult, error: orderError } = await supabase
      .rpc("create_checkout_order", {
        p_product_ids: uniqueIds,
        p_shipping_method: shippingMethod || "standard",
        p_shipping_address: shippingAddress || "",
      });

    if (orderError || !orderResult) {
      // Rollback: release reserved products
      for (const pid of uniqueIds) {
        await supabase
          .from("products")
          .update({ status: "ACTIVE", reserved_by: null, reserved_until: null })
          .eq("id", pid)
          .eq("reserved_by", user.id)
          .eq("status", "RESERVED");
      }
      return NextResponse.json({ error: "Error creando el pedido" }, { status: 500 });
    }

    const orderId = orderResult.order_id;
    const totalCents = Math.round(orderResult.total * 100);

    // 3. Create Stripe PaymentIntent
    let stripe;
    try {
      stripe = (await import("@/lib/stripe")).getStripe();
    } catch {
      // Stripe not configured — return order without payment
      return NextResponse.json({
        orderId,
        order: orderResult,
        clientSecret: null,
        message: "Pedido creado. Stripe no configurado.",
      });
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "eur",
        payment_method_types: ["card"],
        capture_method: "manual",
        metadata: {
          orderId,
          buyerId: user.id,
          productIds: uniqueIds.join(","),
        },
      });
    } catch (stripeError) {
      console.error("[Checkout] Stripe error:", stripeError);
      // Rollback: release reserved products
      for (const pid of uniqueIds) {
        await supabase
          .from("products")
          .update({ status: "ACTIVE", reserved_by: null, reserved_until: null })
          .eq("id", pid)
          .eq("reserved_by", user.id)
          .eq("status", "RESERVED");
      }
      // Cancel the order
      await supabase
        .from("orders")
        .update({ status: "CANCELLED" })
        .eq("id", orderId)
        .eq("status", "PENDING");
      return NextResponse.json({ error: "Error al procesar el pago" }, { status: 500 });
    }

    // 4. Link payment intent to order
    await supabase
      .from("orders")
      .update({ payment_intent_id: paymentIntent.id, status: "PAYMENT_PROCESSING" })
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
