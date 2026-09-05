import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const runtime = "nodejs";

export async function POST(req) {
  // Rate limit: 100 webhook events/min (Stripe retries within this window normally)
  const rl = await rateLimit("stripe:webhook", { limit: 100, windowMs: 60000 });
  if (!rl.allowed) {
    console.warn("[Webhook] Rate limited");
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

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

  // EVENT DEDUPLICATION: Prevents processing the same Stripe event twice.
  // Critical events (side effects) are deduplicated via webhook_events table.
  // Informational events (charge.succeeded/updated) are logged but not deduped.
  const CRITICAL_EVENTS = [
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "refund.created",
    "refund.updated",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ];

  if (CRITICAL_EVENTS.includes(event.type)) {
    // Claim with retry support:
    // 1. Try INSERT (new event → claim succeeds)
    // 2. On unique violation → check existing status:
    //    - completed → return 200 (already processed, no retry)
    //    - processing → return 200 (another request handling it)
    //    - failed → UPDATE to "processing" (allow Stripe retry)
    const { error: dedupError } = await supabase
      .from("webhook_events")
      .insert({
        stripe_event_id: event.id,
        event_type: event.type,
        status: "processing",
      });

    if (dedupError) {
      if (dedupError.code === "23505") {
        // Unique violation — check if we can retry
        const { data: existing } = await supabase
          .from("webhook_events")
          .select("status")
          .eq("stripe_event_id", event.id)
          .single();

        if (!existing || existing.status === "completed") {
          console.log(`[Webhook] Event ${event.id} already completed — skipping`);
          return NextResponse.json({ received: true, duplicate: true });
        }

        if (existing.status === "processing") {
          console.log(`[Webhook] Event ${event.id} being processed by another request — skipping`);
          return NextResponse.json({ received: true, duplicate: true });
        }

        if (existing.status === "failed") {
          // Allow retry: reclaim the event
          console.log(`[Webhook] Retrying failed event ${event.id}`);
          await supabase
            .from("webhook_events")
            .update({ status: "processing", processed_at: null })
            .eq("stripe_event_id", event.id);
        }
      } else {
        // Other DB error — log but continue processing (transient DB issue)
        console.error(`[Webhook] Dedup DB error for ${event.id}:`, dedupError.message);
      }
    }
  }

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

          if (fullRefund) {
            // mark_order_refunded() requires REFUND_PENDING (set by /api/refund).
            // Pass refund_id for identity check: stale webhooks are ignored.
            const { error: refundError } = await supabase.rpc("mark_order_refunded", {
              p_order_id: order.id,
              p_refund_id: refundId,
            });
            if (refundError) {
              console.error(`[Webhook] Error marking order ${order.id} refunded:`, refundError.message);
              criticalError = refundError.message;
            } else {
              console.log(`[Webhook] Order ${order.id} marked REFUNDED (full refund ${totalRefundedCents}/${expectedAmountCents} cents)`);
            }
          } else {
            console.log(`[Webhook] Partial refund ${refundId}: ${totalRefundedCents}/${expectedAmountCents} cents — order remains ${order.status}`);
          }
        } catch (piErr) {
          console.error(`[Webhook] Error verifying full refund for PI ${piId}:`, piErr.message);
          criticalError = piErr.message;
        }
      }

      // Refund failed/canceled: revert REFUND_PENDING → previous status
      // Pass refund_id for identity check: stale webhooks (old refund) are ignored.
      if (refund.status === "failed" || refund.status === "canceled") {
        console.log(`[Webhook] Refund ${refundId} ${refund.status} — reverting order ${order.id} from REFUND_PENDING`);
        const { error: revertError } = await supabase.rpc("resolve_refund_failed", {
          p_order_id: order.id,
          p_refund_id: refundId,
        });
        if (revertError) {
          console.error(`[Webhook] Error reverting order ${order.id} after refund failure:`, revertError.message);
          criticalError = revertError.message;
        } else {
          console.log(`[Webhook] Order ${order.id} reverted after refund ${refund.status}`);
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
    // CRITICAL: Premium controls user privileges — DB failure must trigger retry.
    // ATOMIC SYNC: All version/terminal-state checks happen inside PostgreSQL
    // via sync_subscription_from_stripe() RPC. The DB decides — not JavaScript.
    // Handles: lost created events, out-of-order delivery, terminal state protection.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription ${event.type.split(".")[2]}: ${sub.id} status=${sub.status}`);

      // Identity is critical: without user_id we cannot sync privileges.
      if (!userId) {
        console.error("[Webhook] Subscription missing user_id metadata:", sub.id);
        criticalError = `Subscription ${sub.id} missing user identity`;
        break;
      }

      // Atomic: DB decides whether to INSERT, UPDATE, or no-op.
      // - INSERT if no row exists (converges for lost created events)
      // - UPDATE only if incoming stripe_updated_at > existing (sole authority)
      // - Events with equal or older stripe_updated_at → no-op
      const { error } = await supabase.rpc("sync_subscription_from_stripe", {
        p_user_id: userId,
        p_stripe_subscription_id: sub.id,
        p_stripe_customer_id: sub.customer,
        p_status: sub.status,
        p_plan: "premium_monthly",
        p_amount: (sub.items?.data?.[0]?.price?.unit_amount || 499) / 100,
        p_current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
        p_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        p_cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        p_stripe_updated_at: new Date(sub.updated * 1000).toISOString(),
      });
      if (error) {
        console.error(`[Webhook] Subscription ${event.type.split(".")[2]} error:`, error.message);
        criticalError = error.message;
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
    // Mark event as failed (allows retry on next delivery)
    if (CRITICAL_EVENTS.includes(event.type)) {
      await supabase
        .from("webhook_events")
        .update({ status: "failed", processed_at: new Date().toISOString() })
        .eq("stripe_event_id", event.id);
    }
    console.error("[Webhook] Returning 500 to trigger Stripe retry:", criticalError);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }

  // Mark event as completed (prevents reprocessing on retry)
  if (CRITICAL_EVENTS.includes(event.type)) {
    await supabase
      .from("webhook_events")
      .update({ status: "completed", processed_at: new Date().toISOString() })
      .eq("stripe_event_id", event.id);
  }

  return NextResponse.json({ received: true });
}
