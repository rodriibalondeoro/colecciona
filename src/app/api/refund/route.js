import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`refund:${ip}`, { limit: 3, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { orderId, reason } = body;

    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
    }

    const supabase = createClient(url, key);

    // 1. Find order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, status, payment_intent_id, total")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // 2. Verify user is the SELLER (only seller can initiate refund)
    // Buyer should open a dispute instead of directly requesting refund
    if (order.seller_id !== user.id) {
      return NextResponse.json(
        { error: "Only the seller can initiate a refund. Buyers should open a dispute." },
        { status: 403 }
      );
    }

    // 3. Verify order is in refundable state
    // DISPUTED included: seller can resolve a dispute by refunding the buyer
    if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED", "DISPUTED"].includes(order.status)) {
      return NextResponse.json(
        { error: "Unable to initiate refund for this order" },
        { status: 400 }
      );
    }

    // 4. Verify payment_intent_id exists
    if (!order.payment_intent_id) {
      return NextResponse.json(
        { error: "No payment intent found for this order" },
        { status: 400 }
      );
    }

    // 5. Atomically transition to REFUND_PENDING (interlock)
    // This blocks DISPUTED→COMPLETED and other resolutions while refund is in flight.
    const { data: ref, error: beginError } = await supabase.rpc("begin_refund", {
      p_order_id: orderId,
    });

    if (beginError || !ref) {
      console.error("[Refund] begin_refund failed:", beginError?.message);
      return NextResponse.json(
        { error: "Unable to initiate refund" },
        { status: 409 }
      );
    }

    // 6. Create Stripe refund
    // The order is now REFUND_PENDING. Webhook (refund.created/updated) will
    // confirm and call mark_order_refunded().
    let refund;
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: order.payment_intent_id,
          reason: reason || "requested_by_customer",
          metadata: { order_id: orderId },
        },
        {
          idempotencyKey: `refund:${orderId}`,
        }
      );
    } catch (stripeErr) {
      console.error("[Refund] Stripe refund create failed:", stripeErr);

      // CRITICAL: The error is ambiguous (timeout/network). Stripe may have
      // actually created the refund — the response was just lost.
      // DO NOT revert REFUND_PENDING here. Keep REFUND_PENDING and let the
      // webhook (refund.created/updated) confirm the true outcome.
      // This follows the same rule as capture-payment: after crossing the
      // Stripe boundary, never assume the operation did NOT happen.
      return NextResponse.json(
        { error: "Refund initiated but outcome pending confirmation" },
        { status: 500 }
      );
    }

    console.log(`[Refund] Created refund ${refund.id} for order ${orderId}`);

    // 6b. Bind the active refund ID (ORDER ↔ ACTIVE REFUND identity)
    // Enables webhook identity check: only the current refund's events are honored.
    const { error: bindError } = await supabase.rpc("bind_active_refund", {
      p_order_id: orderId,
      p_refund_id: refund.id,
    });
    if (bindError) {
      console.error(`[Refund] Failed to bind active refund for order ${orderId}:`, bindError.message);
      // Stripe refund is created but identity binding failed.
      // Return 500 — webhook/reconciliation will attempt recovery via metadata.order_id.
      return NextResponse.json(
        { error: "Refund created but identity binding failed — reconciliation will recover" },
        { status: 500 }
      );
    }

    // 7. Persist refund evidence (pending state — webhook updates to succeeded)
    // is_full_refund set to false here: Stripe is the financial authority.
    const { error: persistError } = await supabase.from("refunds").insert({
      order_id: orderId,
      payment_intent_id: order.payment_intent_id,
      stripe_refund_id: refund.id,
      amount_cents: refund.amount,
      status: refund.status || "pending",
      is_full_refund: false, // pending confirmation by Stripe webhook
      reason: reason || "requested_by_customer",
    });

    if (persistError) {
      console.error(`[Refund] Failed to persist refund for order ${orderId}:`, persistError.message);
      // CRITICAL: Stripe already created the refund. Do NOT revert REFUND_PENDING.
      // Return 500 so the caller knows persistence failed — webhook will recover.
      return NextResponse.json(
        { error: "Refund created but confirmation is pending" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      refund_id: refund.id,
      status: refund.status,
      message: "Refund initiated. Order is now REFUND_PENDING.",
    });
  } catch (error) {
    console.error("[Refund] Error:", error);

    // Hide internal Stripe errors from client
    if (error.type === "StripeInvalidRequestError") {
      return NextResponse.json(
        { error: "Unable to initiate refund" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
