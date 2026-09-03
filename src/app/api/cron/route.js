import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

// Policy: requires_action orders older than this are cancelled
const REQUIRES_ACTION_MAX_HOURS = 24;

export async function GET(req) {
  // Verify cron secret — fail-closed: no secret = no access
  if (!cronSecret) {
    console.error("[Cron] CRON_SECRET not configured — endpoint disabled");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!url || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const supabase = createClient(url, key);
  const results = {
    checked: 0,
    confirmed: 0,
    released: 0,
    kept: 0,
    force_cancelled: 0,
    recovered: 0,
    errors: [],
  };

  try {
    // 1. Get stale PAYMENT_PROCESSING orders (> 1 hour)
    const { data: staleOrders, error } = await supabase
      .rpc("cleanup_stale_payment_processing");

    if (error) {
      console.error("[Cron] Error fetching stale orders:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!staleOrders || staleOrders.length === 0) {
      return NextResponse.json({ message: "No stale orders", results });
    }

    console.log(`[Cron] Found ${staleOrders.length} stale PAYMENT_PROCESSING orders`);

    // 2. Check each with Stripe
    for (const order of staleOrders) {
      results.checked++;
      const hoursStale = order.hours_stale || 0;

      try {
        const pi = await stripe.paymentIntents.retrieve(order.payment_intent_id);

        if (pi.status === "succeeded") {
          // Payment succeeded — confirm sale
          console.log(`[Cron] PI ${pi.id} succeeded — confirming sale for order ${order.order_id}`);
          const { error: confirmError } = await supabase.rpc("mark_products_sold_by_payment_intent", {
            p_payment_intent_id: order.payment_intent_id,
          });
          if (confirmError) {
            results.errors.push({ order_id: order.order_id, action: "confirm", error: confirmError.message });
          } else {
            results.confirmed++;
          }

        } else if (pi.status === "canceled" || pi.status === "requires_payment_method") {
          // Payment failed — release reservations
          console.log(`[Cron] PI ${pi.id} ${pi.status} — releasing order ${order.order_id}`);
          const { error: releaseError } = await supabase.rpc("release_product_reservations_by_payment_intent", {
            p_payment_intent_id: order.payment_intent_id,
          });
          if (releaseError) {
            results.errors.push({ order_id: order.order_id, action: "release", error: releaseError.message });
          } else {
            results.released++;
          }

        } else if (pi.status === "requires_action" && hoursStale > REQUIRES_ACTION_MAX_HOURS) {
          // requires_action for too long — must confirm cancel BEFORE releasing
          console.log(`[Cron] PI ${pi.id} requires_action for ${hoursStale.toFixed(1)}h — attempting cancel`);
          try {
            const canceledPI = await stripe.paymentIntents.cancel(pi.id, {
              cancellation_reason: "abandoned",
            });
            // Verify Stripe actually cancelled it
            if (canceledPI.status !== "canceled") {
              console.warn(`[Cron] PI ${pi.id} cancel returned status=${canceledPI.status} — NOT releasing`);
              results.errors.push({
                order_id: order.order_id,
                action: "cancel_verify",
                error: `PaymentIntent status after cancel: ${canceledPI.status}`,
              });
              results.kept++;
              continue;
            }
          } catch (cancelErr) {
            // Cancel failed — do NOT release. Re-check status to understand why.
            console.error(`[Cron] PI ${pi.id} cancel failed: ${cancelErr.message}`);
            try {
              const piAfter = await stripe.paymentIntents.retrieve(pi.id);
              if (piAfter.status === "canceled" || piAfter.status === "requires_payment_method") {
                // Already terminal — safe to release
                console.log(`[Cron] PI ${pi.id} already ${piAfter.status} — safe to release`);
              } else {
                // Still active — do NOT release, retry next cron run
                console.warn(`[Cron] PI ${pi.id} still ${piAfter.status} — NOT releasing, will retry`);
                results.errors.push({
                  order_id: order.order_id,
                  action: "cancel_failed",
                  error: `Cancel failed and PI still ${piAfter.status}: ${cancelErr.message}`,
                });
                results.kept++;
                continue;
              }
            } catch (retrieveErr) {
              // Can't even retrieve — definitely do NOT release
              console.error(`[Cron] PI ${pi.id} retrieve also failed: ${retrieveErr.message}`);
              results.errors.push({
                order_id: order.order_id,
                action: "retrieve_failed",
                error: `Cannot verify PI status: ${retrieveErr.message}`,
              });
              results.kept++;
              continue;
            }
          }
          // Only reaches here if cancel succeeded or PI already terminal
          const { error: releaseError } = await supabase.rpc("release_product_reservations_by_payment_intent", {
            p_payment_intent_id: order.payment_intent_id,
          });
          if (releaseError) {
            results.errors.push({ order_id: order.order_id, action: "release", error: releaseError.message });
          } else {
            results.force_cancelled++;
          }

        } else {
          // processing, requires_action < 24h, etc. — leave it alone
          console.log(`[Cron] PI ${pi.id} status=${pi.status} (${hoursStale.toFixed(1)}h) — keeping order ${order.order_id}`);
          results.kept++;
        }
      } catch (stripeError) {
        console.error(`[Cron] Stripe error for order ${order.order_id}:`, stripeError.message);
        results.errors.push({ order_id: order.order_id, action: "stripe_query", error: stripeError.message });
      }
    }

    // 3. RECOVERY: Find orphaned PENDING orders without payment_intent_id
    // Handles server crash between PI creation and order update.
    // The checkout route stores order_id in PI metadata, so we can search Stripe.
    const { data: orphanedOrders, error: orphanError } = await supabase
      .rpc("cleanup_orphaned_pending_orders");

    if (orphanError) {
      console.error("[Cron] Error fetching orphaned orders:", orphanError.message);
    } else if (orphanedOrders && orphanedOrders.length > 0) {
      console.log(`[Cron] Found ${orphanedOrders.length} orphaned PENDING orders — attempting recovery`);

      for (const order of orphanedOrders) {
        try {
          // Search Stripe for PI with this order_id in metadata
          const piList = await stripe.paymentIntents.list({
            limit: 10,
          });

          // Find PI with matching order_id in metadata
          const matchingPI = piList.data.find(
            (pi) => pi.metadata?.orderId === order.order_id
          );

          if (!matchingPI) {
            // No PI found in Stripe — this is a pure orphan, let it be cancelled
            console.log(`[Cron] Orphaned order ${order.order_id} — no PI found in Stripe, will be cancelled`);
            continue;
          }

          console.log(`[Cron] Recovery: Found PI ${matchingPI.id} for order ${order.order_id} (status=${matchingPI.status})`);

          // Link PI to order and transition based on PI status
          if (matchingPI.status === "succeeded") {
            // PI succeeded — link and confirm payment
            await supabase
              .from("orders")
              .update({
                payment_intent_id: matchingPI.id,
                status: "PAYMENT_PROCESSING",
                payment_processing_started_at: new Date().toISOString(),
              })
              .eq("id", order.order_id);

            const { error: confirmError } = await supabase.rpc("mark_products_sold_by_payment_intent", {
              p_payment_intent_id: matchingPI.id,
            });
            if (confirmError) {
              console.error(`[Cron] Recovery: Confirm failed for order ${order.order_id}:`, confirmError.message);
              results.errors.push({ order_id: order.order_id, action: "recovery_confirm", error: confirmError.message });
            } else {
              console.log(`[Cron] Recovery: Order ${order.order_id} confirmed (PI succeeded)`);
              results.confirmed++;
            }

          } else if (matchingPI.status === "canceled" || matchingPI.status === "requires_payment_method") {
            // PI failed/cancelled — link and release reservations
            await supabase
              .from("orders")
              .update({
                payment_intent_id: matchingPI.id,
                status: "PAYMENT_PROCESSING",
                payment_processing_started_at: new Date().toISOString(),
              })
              .eq("id", order.order_id);

            const { error: releaseError } = await supabase.rpc("release_product_reservations_by_payment_intent", {
              p_payment_intent_id: matchingPI.id,
            });
            if (releaseError) {
              console.error(`[Cron] Recovery: Release failed for order ${order.order_id}:`, releaseError.message);
              results.errors.push({ order_id: order.order_id, action: "recovery_release", error: releaseError.message });
            } else {
              console.log(`[Cron] Recovery: Order ${order.order_id} released (PI ${matchingPI.status})`);
              results.released++;
            }

          } else if (matchingPI.status === "requires_action" || matchingPI.status === "processing") {
            // PI still active — link and transition to PAYMENT_PROCESSING
            // Webhook will handle final state
            await supabase
              .from("orders")
              .update({
                payment_intent_id: matchingPI.id,
                status: "PAYMENT_PROCESSING",
                payment_processing_started_at: new Date().toISOString(),
              })
              .eq("id", order.order_id);

            console.log(`[Cron] Recovery: Order ${order.order_id} linked to PI ${matchingPI.id} (status=${matchingPI.status})`);
            results.recovered = (results.recovered || 0) + 1;

          } else {
            // Unknown PI status — log and skip
            console.warn(`[Cron] Recovery: PI ${matchingPI.id} has unexpected status ${matchingPI.status} for order ${order.order_id}`);
            results.errors.push({ order_id: order.order_id, action: "recovery_unknown_status", error: `PI status: ${matchingPI.status}` });
          }

        } catch (recoveryErr) {
          console.error(`[Cron] Recovery error for order ${order.order_id}:`, recoveryErr.message);
          results.errors.push({ order_id: order.order_id, action: "recovery", error: recoveryErr.message });
        }
      }
    }

    return NextResponse.json({ message: "Cron completed", results });
  } catch (err) {
    console.error("[Cron] Fatal error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
