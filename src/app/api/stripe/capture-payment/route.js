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

    const { paymentIntentId } = await req.json();

    if (!paymentIntentId) {
      return NextResponse.json({ error: "paymentIntentId es obligatorio" }, { status: 400 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
    }

    const supabase = createClient(url, key);

    // AUTHORIZATION CHAIN:
    // 1. Find order by payment_intent_id
    // 2. Verify user is a participant (buyer or seller)
    // 3. Verify order is in PAYMENT_PROCESSING state
    // 4. Verify PI status is requires_capture via Stripe
    // 5. Only then capture

    // 1. Find order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, status, payment_intent_id")
      .eq("payment_intent_id", paymentIntentId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found for this PaymentIntent" }, { status: 404 });
    }

    // 2. Verify user is a participant (buyer or seller)
    const isParticipant = order.buyer_id === user.id || order.seller_id === user.id;
    if (!isParticipant) {
      return NextResponse.json({ error: "Not authorized to capture this payment" }, { status: 403 });
    }

    // 3. Verify order is in PAYMENT_PROCESSING state
    if (order.status !== "PAYMENT_PROCESSING") {
      return NextResponse.json({ error: `Cannot capture order in status: ${order.status}` }, { status: 400 });
    }

    // 4. Verify PI status is requires_capture via Stripe
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "requires_capture") {
      return NextResponse.json({ error: `PaymentIntent status is ${pi.status}, expected requires_capture` }, { status: 400 });
    }

    // 5. Capture
    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);

    // 6. Atomic: order→PAID + products→SOLD via single RPC
    const { data, error: rpcError } = await supabase.rpc("mark_products_sold_by_payment_intent", {
      p_payment_intent_id: paymentIntentId,
    });

    if (rpcError) {
      console.error("[Capture] RPC error:", rpcError.message);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    // 7. Notify seller
    if (order.seller_id) {
      await supabase.from("notifications").insert({
        user_id: order.seller_id,
        type: "payment_received",
        title: "Pago recibido",
        body: "El pago de tu venta ha sido capturado y los fondos están disponibles.",
      });
    }

    return NextResponse.json({
      success: true,
      status: paymentIntent.status,
    });
  } catch (error) {
    console.error("Error en Stripe Capture API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
