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

    // AUTHORIZATION CHAIN (end-to-end serialization via capture_status):
    // 1. begin_capture_order() — atomic lock via capture_status (persists across Stripe call)
    // 2. Verify user is the SELLER
    // 3. Verify PI status is requires_capture via Stripe
    // 4. Capture with idempotency key
    // 5. Confirm via RPC (idempotent — webhook/cron recover if this fails)
    // 6. complete_capture_order() — reset capture_status to 'captured'
    // On ANY failure: reset_capture_order() — reset capture_status to 'idle'

    let captureSucceeded = false;

    try {
      // 1. Lock order atomically (capture_status = 'capturing' — persists across Stripe call)
      const { data: lockResult, error: lockError } = await supabase
        .rpc("begin_capture_order", { p_payment_intent_id: paymentIntentId });

      if (lockError || !lockResult) {
        return NextResponse.json({ error: "Cannot capture this order" }, { status: 400 });
      }

      const order = lockResult;

      // 2. Verify user is the SELLER (only seller captures when shipping)
      if (order.seller_id !== user.id) {
        return NextResponse.json({ error: "Only the seller can capture this payment" }, { status: 403 });
      }

      // 3. Verify PI status is requires_capture via Stripe
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "requires_capture") {
        return NextResponse.json({ error: `PaymentIntent status is ${pi.status}, expected requires_capture` }, { status: 400 });
      }

      // 4. Capture with idempotency key (prevents duplicate capture on retry/timeout)
      const paymentIntent = await stripe.paymentIntents.capture(
        paymentIntentId,
        {},
        { idempotencyKey: `capture:${paymentIntentId}` }
      );

      captureSucceeded = true;

      // 5. Atomic: order→PAID + products→SOLD via single RPC
      const { data, error: rpcError } = await supabase.rpc("mark_products_sold_by_payment_intent", {
        p_payment_intent_id: paymentIntentId,
      });

      if (rpcError) {
        console.error("[Capture] RPC error:", rpcError.message);
        // Stripe already captured — webhook/cron will recover.
        // Do NOT expose internal error details to client.
        return NextResponse.json(
          { error: "Payment captured but order confirmation is pending" },
          { status: 500 }
        );
      }

      // 6. Complete capture: reset capture_status to 'captured'
      await supabase.rpc("complete_capture_order", { p_payment_intent_id: paymentIntentId });

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
      console.error("[Capture] Error:", error.message);

      // On ANY failure: reset capture_status to 'idle' (allows retry)
      // Only reset if we acquired the lock (begin_capture_order succeeded)
      if (!captureSucceeded) {
        try {
          await supabase.rpc("reset_capture_order", { p_payment_intent_id: paymentIntentId });
        } catch (resetError) {
          console.error("[Capture] Failed to reset capture_status:", resetError.message);
        }
      }

      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  } catch (error) {
    console.error("Error en Stripe Capture API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
