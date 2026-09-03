import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const runtime = "nodejs";

export async function POST(req) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    console.error("[Webhook] No stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  if (!webhookSecret) {
    console.error("[Webhook] STRIPE_WEBHOOK_SECRET no configurado");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error("[Webhook] Stripe not configured");
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[Webhook] Firma inválida:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`[Webhook] Evento recibido: ${event.type}`);

  const supabase = createClient(url, key);

  // Track errors: if a critical RPC fails, return 500 so Stripe retries.
  // Stripe retries with exponential backoff up to 3 days.
  let criticalError = null;

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      console.log(`[Webhook] Payment succeeded: ${pi.id}`);
      // IDEMPOTENT: confirm_payment returns "Already confirmed" if order already PAID.
      // With capture_method: "manual", this fires ONLY after explicit capture().
      // RACE WINDOW: If webhook arrives before order status is updated to PAYMENT_PROCESSING
      // (between PI creation and order update), confirm_payment will fail with
      // "not PAYMENT_PROCESSING". We return 500 → Stripe retries → eventually succeeds.
      const { data, error } = await supabase.rpc("mark_products_sold_by_payment_intent", {
        p_payment_intent_id: pi.id,
      });
      if (error) {
        console.error("[Webhook] Error marking products sold:", error.message);
        criticalError = error.message;
      } else {
        console.log("[Webhook] Order confirmed:", data);
      }
      break;
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      console.log(`[Webhook] Payment failed: ${pi.id}`);
      // IDEMPOTENT: release returns "No reservations" if order already CANCELLED/PAID.
      // If succeeded webhook arrived first, order is PAID → this is a no-op.
      const { data, error } = await supabase.rpc("release_product_reservations_by_payment_intent", {
        p_payment_intent_id: pi.id,
      });
      if (error) {
        console.error("[Webhook] Error releasing reservations:", error.message);
        criticalError = error.message;
      } else {
        console.log("[Webhook] Reservations released:", data);
      }
      break;
    }
    case "payment_intent.canceled": {
      const pi = event.data.object;
      console.log(`[Webhook] Payment canceled: ${pi.id}`);
      // IDEMPOTENT: release returns "No reservations" if order already CANCELLED/PAID.
      // Handles: explicit cancel, Stripe auto-cancel, merchant cancel.
      // Consistent with payment_intent.canceled policy — releases reservations immediately.
      const { data, error } = await supabase.rpc("release_product_reservations_by_payment_intent", {
        p_payment_intent_id: pi.id,
      });
      if (error) {
        console.error("[Webhook] Error releasing reservations on cancel:", error.message);
        criticalError = error.message;
      } else {
        console.log("[Webhook] Reservations released on cancel:", data);
      }
      break;
    }
    case "charge.succeeded":
    case "charge.updated":
      console.log(`[Webhook] ${event.type} — handled`);
      break;

    case "refund.created":
    case "refund.updated": {
      const refund = event.data.object;
      console.log(`[Webhook] Refund ${event.type}: ${refund.id} (amount=${refund.amount}, status=${refund.status})`);

      // Individual Refund object: refund.id, refund.amount, refund.status, refund.payment_intent
      const piId = refund.payment_intent;
      const refundId = refund.id;

      // Find order by payment_intent_id
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, status, total")
        .eq("payment_intent_id", piId)
        .single();

      // CRITICAL: DB failure (timeout, connection, Supabase down) → 500 → Stripe retry.
      if (orderError) {
        console.error(`[Webhook] DB error finding order for PI ${piId}:`, orderError.message);
        criticalError = orderError.message;
        break;
      }

      // Identity inconsistency: a marketplace PI should always have an order.
      if (!order) {
        console.error(`[Webhook] No order found for PI ${piId} — identity inconsistency`);
        criticalError = `No order found for PI ${piId}`;
        break;
      }

      // Compute full-refund signal using cumulative refund amounts for this PI later;
      // here we persist THIS individual refund accurately.
      // UPSERT on stripe_refund_id: /api/refund created PENDING record, this confirms it.
      const { error: persistError } = await supabase.from("refunds").upsert(
        {
          order_id: order.id,
          payment_intent_id: piId,
          stripe_refund_id: refundId,
          amount_cents: refund.amount,
          status: refund.status === "succeeded" ? "succeeded" : refund.status,
          reason: refund.reason || null,
        },
        { onConflict: "stripe_refund_id" }
      );

      if (persistError) {
        console.error(`[Webhook] Failed to persist refund ${refundId} for order ${order.id}:`, persistError.message);
        criticalError = persistError.message;
        break;
      }

      // Full-refund check: use the latest Charge's cumulative amount_refunded.
      // Stripe is the financial authority for whether the order is fully refunded.
      if (refund.status === "succeeded") {
        try {
          const expectedAmountCents = Math.round(Number(order.total) * 100);

          // Retrieve the Charge to get cumulative amount_refunded (all refunds summed).
          let totalRefundedCents = null;
          const chargeId = refund.charge;
          if (chargeId) {
            const ch = await stripe.charges.retrieve(chargeId);
            totalRefundedCents = ch.amount_refunded;
          }

          if (totalRefundedCents === null) {
            console.warn(`[Webhook] Could not determine cumulative refunded for refund ${refundId}`);
            break;
          }

          const fullRefund = totalRefundedCents >= expectedAmountCents;

          // Update is_full_refund on this individual refund record.
          // CRITICAL: check the error — incomplete financial evidence must trigger retry.
          const { error: fullRefundUpdateError } = await supabase.from("refunds")
            .update({ is_full_refund: fullRefund })
            .eq("stripe_refund_id", refundId);

          if (fullRefundUpdateError) {
            console.error(`[Webhook] Failed to update is_full_refund for ${refundId}:`, fullRefundUpdateError.message);
            criticalError = fullRefundUpdateError.message;
            break;
          }

          if (fullRefund && ["PAID", "PREPARING", "SHIPPED", "DELIVERED", "DISPUTED"].includes(order.status)) {
            const { error: refundError } = await supabase.rpc("mark_order_refunded", {
              p_order_id: order.id,
            });
            if (refundError) {
              console.error(`[Webhook] Error marking order ${order.id} refunded:`, refundError.message);
              criticalError = refundError.message;
            } else {
              console.log(`[Webhook] Order ${order.id} marked REFUNDED (full refund ${totalRefundedCents}/${expectedAmountCents} cents)`);
            }
          } else if (!fullRefund) {
            console.log(`[Webhook] Partial refund ${refundId}: ${totalRefundedCents}/${expectedAmountCents} cents — order remains ${order.status}`);
          }
        } catch (piErr) {
          console.error(`[Webhook] Error verifying full refund for PI ${piId}:`, piErr.message);
          criticalError = piErr.message;
        }
      }
      break;
    }

    case "charge.refunded": {
      // Legacy/fallback for charge-level refund events: refresh via refund.created/updated.
      // We keep this case as a no-op log since per-refund events carry authoritative data.
      const charge = event.data.object;
      console.log(`[Webhook] charge.refunded received for charge ${charge.id} — handled via refund.* events`);
      break;
    }

    // --- Premium Subscription Events ---
    // Non-critical: log errors but don't block webhook response
    case "customer.subscription.created": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription created: ${sub.id} for user ${userId}`);
      if (userId) {
        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          status: sub.status,
          plan: "premium_monthly",
          amount: (sub.items?.data?.[0]?.price?.unit_amount || 499) / 100,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }, { onConflict: "stripe_subscription_id" });
        if (error) console.error("[Webhook] Subscription upsert error:", error.message);
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription updated: ${sub.id} status=${sub.status}`);
      if (userId) {
        const { error } = await supabase.from("subscriptions").update({
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        }).eq("stripe_subscription_id", sub.id);
        if (error) console.error("[Webhook] Subscription update error:", error.message);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription deleted: ${sub.id}`);
      if (userId) {
        const { error } = await supabase.from("subscriptions").update({
          status: "canceled",
        }).eq("stripe_subscription_id", sub.id);
        if (error) console.error("[Webhook] Subscription delete error:", error.message);
      }
      break;
    }
    default:
      console.log(`[Webhook] Evento no manejado: ${event.type}`);
  }

  // CRITICAL: Return non-2xx on RPC failure so Stripe retries.
  // Stripe retries with exponential backoff (up to 3 days).
  // This ensures transient errors (race conditions, DB locks) are recovered.
  // Do NOT expose internal details in response — log them instead.
  if (criticalError) {
    console.error("[Webhook] Returning 500 to trigger Stripe retry:", criticalError);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
