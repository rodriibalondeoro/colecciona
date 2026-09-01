import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const { productIds, shippingMethod, shippingAddress } = await req.json();

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: "No hay productos seleccionados" }, { status: 400 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const supabase = createClient(url, key);

    // 1. Reserve products via RPC
    const reservedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { data: reserved, error: reserveError } = await supabase
      .rpc("reserve_products_for_checkout", {
        p_product_ids: productIds,
        p_buyer_id: user.id,
        p_reserved_until: reservedUntil,
      });

    if (reserveError || !reserved) {
      return NextResponse.json({ error: "Uno o más productos ya no están disponibles" }, { status: 409 });
    }

    // 2. Create order via RPC (server-calculates prices)
    const { data: orderResult, error: orderError } = await supabase
      .rpc("create_checkout_order", {
        p_product_ids: productIds,
        p_shipping_method: shippingMethod || "standard",
        p_shipping_address: shippingAddress || "",
      });

    if (orderError || !orderResult) {
      // Release reserved products on failure
      await supabase.rpc("cancel_order", { p_order_id: null }).catch(() => {});
      return NextResponse.json({ error: "Error creando el pedido" }, { status: 500 });
    }

    const orderId = orderResult.order_id;
    const totalCents = Math.round(orderResult.total * 100);

    // 3. Create Stripe PaymentIntent
    const stripe = getStripe();
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
          productIds: productIds.join(","),
        },
      });
    } catch (stripeError) {
      // Cancel order and release products on Stripe failure
      await supabase.rpc("cancel_order", { p_order_id: orderId }).catch(() => {});
      throw stripeError;
    }

    // 4. Link payment intent to order
    await supabase
      .from("orders")
      .update({ payment_intent_id: paymentIntent.id })
      .eq("id", orderId);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      amount: totalCents,
      paymentIntentId: paymentIntent.id,
      orderId,
    });
  } catch (error) {
    console.error("Error en Stripe PaymentIntent API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
