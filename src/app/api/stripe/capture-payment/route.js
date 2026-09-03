import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  let captureInitiated = false;
  let orderId = null;

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
    // 1. begin_capture_order() — atomic lock + status check (serializes concurrent captures)
    // 2. Verify user is the SELLER
    // 3. Verify PI status is requires_capture via Stripe
    // 4. Capture with idempotency key
    // 5. Confirm via RPC (idempotent — webhook/cron recover if this fails)

    // CRITICAL RULE: clear_capture_in_progress() ONLY allowed BEFORE Stripe capture()
    // AFTER Stripe capture(): financial state is unknown → leave CAPTURING → webhook/cron recover

    // 1. Lock order atomically (serializes concurrent capture attempts)
    const { data: lockResult, error: lockError } = await supabase
      .rpc("begin_capture_order", { p_payment_intent_id: paymentIntentId });

    if (lockError || !lockResult) {
      return NextResponse.json({ error: "Cannot capture this order" }, { status: 400 });
    }

    orderId = lockResult.order_id;
    const order = lockResult;

    // 2. Verify user is the SELLER (only seller captures when shipping)
    // BEFORE Stripe capture → safe to clear on failure
    if (order.seller_id !== user.id) {
      await supabase.rpc("clear_capture_in_progress", { p_order_id: orderId });
      return NextResponse.json({ error: "Only the seller can capture this payment" }, { status: 403 });
    }

    // 3. Verify PI status is requires_capture via Stripe
    // BEFORE Stripe capture → safe to clear on failure
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "requires_capture") {
      await supabase.rpc("clear_capture_in_progress", { p_order_id: orderId });
      return NextResponse.json({ error: `PaymentIntent status is ${pi.status}, expected requires_capture` }, { status: 400 });
    }

    // 4. Capture with idempotency key (prevents duplicate capture on retry/timeout)
    // AFTER this point: DO NOT clear capture_in_progress on error
    captureInitiated = true;
    const paymentIntent = await stripe.paymentIntents.capture(
      paymentIntentId,
      {},
      { idempotencyKey: `capture:${paymentIntentId}` }
    );

    // 5. Atomic: order→PAID + products→SOLD via single RPC
    const { data, error: rpcError } = await supabase.rpc("mark_products_sold_by_payment_intent", {
      p_payment_intent_id: paymentIntentId,
    });

    if (rpcError) {
      console.error("[Capture] RPC error:", rpcError.message);
      // Stripe already captured — webhook/cron will recover.
      // Do NOT clear capture_in_progress → CAPTURING stays → webhook/cron confirm.
      return NextResponse.json(
        { error: "Payment captured but order confirmation is pending" },
        { status: 500 }
      );
    }

    // 6. Notify seller
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

    // CRITICAL: Only clear if capture was NOT initiated
    // If capture was initiated, financial state is unknown → leave CAPTURING → webhook/cron recover
    if (!captureInitiated && orderId) {
      // Error BEFORE Stripe capture → safe to reset to PAYMENT_PROCESSING
      try {
        const supabase = createClient(url, key);
        await supabase.rpc("clear_capture_in_progress", { p_order_id: orderId });
      } catch (clearErr) {
        console.error("[Capture] Failed to clear capture lock:", clearErr.message);
      }
    }
    // If captureInitiated = true: leave as CAPTURING → webhook/cron recover via Stripe query

    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
