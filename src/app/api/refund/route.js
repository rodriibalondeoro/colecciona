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

    const { orderId, reason } = await req.json();

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

    // 5. Create Stripe refund
    // NOTE: This initiates the refund. The actual status update happens
    // via the charge.refunded webhook, NOT here.
    const refund = await stripe.refunds.create(
      {
        payment_intent: order.payment_intent_id,
        reason: reason || "requested_by_customer",
      },
      {
        idempotencyKey: `refund:${orderId}`,
      }
    );

    console.log(`[Refund] Created refund ${refund.id} for order ${orderId}`);

    // 6. Persist refund evidence (pending state — webhook updates to succeeded)
    // is_full_refund set to false here: Stripe is the financial authority.
    // The webhook will compute the true is_full_refund by comparing amount_refunded vs total.
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
      // Refund created in Stripe but evidence not persisted — log, webhook will persist again
    }

    // 7. Do NOT update order status here — wait for webhook confirmation
    // The charge.refunded webhook will call mark_order_refunded()

    return NextResponse.json({
      success: true,
      refund_id: refund.id,
      status: refund.status,
      message: "Refund initiated. Status will be updated via webhook.",
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
