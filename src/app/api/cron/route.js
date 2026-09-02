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
          // requires_action for too long — cancel PaymentIntent + release
          console.log(`[Cron] PI ${pi.id} requires_action for ${hoursStale.toFixed(1)}h — force cancelling`);
          try {
            await stripe.paymentIntents.cancel(pi.id, {
              cancellation_reason: "abandoned",
            });
          } catch (cancelErr) {
            console.warn(`[Cron] Stripe cancel error (may already be canceled):`, cancelErr.message);
          }
          const { error: releaseError } = await supabase.rpc("release_product_reservations_by_payment_intent", {
            p_payment_intent_id: order.payment_intent_id,
          });
          if (releaseError) {
            results.errors.push({ order_id: order.order_id, action: "force_cancel", error: releaseError.message });
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

    return NextResponse.json({ message: "Cron completed", results });
  } catch (err) {
    console.error("[Cron] Fatal error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
