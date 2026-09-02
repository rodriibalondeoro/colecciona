import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

export async function GET(req) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
  const results = { checked: 0, confirmed: 0, released: 0, kept: 0, errors: [] };

  try {
    // 1. Get stale PAYMENT_PROCESSING orders
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
      try {
        const pi = await stripe.paymentIntents.retrieve(order.payment_intent_id);

        if (pi.status === "succeeded") {
          // Payment actually succeeded — confirm sale
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
        } else {
          // processing, requires_action, etc. — leave it alone
          console.log(`[Cron] PI ${pi.id} status=${pi.status} — keeping order ${order.order_id}`);
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
