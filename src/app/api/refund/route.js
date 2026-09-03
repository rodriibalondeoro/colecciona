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

    // 2. Verify user is a participant
    if (order.buyer_id !== user.id && order.seller_id !== user.id) {
      return NextResponse.json({ error: "Not a participant in this order" }, { status: 403 });
    }

    // 3. Verify order is in refundable state
    if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED"].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot refund order in status: ${order.status}` },
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

    // 6. Do NOT update order status here — wait for webhook confirmation
    // The charge.refunded webhook will call mark_order_refunded()

    return NextResponse.json({
      success: true,
      refund_id: refund.id,
      status: refund.status,
      message: "Refund initiated. Status will be updated via webhook.",
    });
  } catch (error) {
    console.error("[Refund] Error:", error);

    // Handle Stripe-specific errors
    if (error.type === "StripeInvalidRequestError") {
      return NextResponse.json(
        { error: `Stripe error: ${error.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
