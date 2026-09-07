import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth, createUserClient } from "@/lib/serverAuth";
import { getStripe } from "@/lib/stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = req.headers.get("authorization")?.slice(7);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const userClient = createUserClient(token);
    const { data: profile } = await userClient
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const serviceClient = createClient(url, serviceKey);

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const { orderId, type } = body;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!orderId || !UUID_RE.test(orderId)) {
      return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
    }
    if (type !== "refund" && type !== "complete") {
      return NextResponse.json({ error: "type must be 'refund' or 'complete'" }, { status: 400 });
    }

    if (type === "refund") {
      const stripe = getStripe();
      if (!stripe) {
        return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
      }

      const { data: order, error: orderError } = await serviceClient
        .from("orders")
        .select("id, status, seller_id, buyer_id, payment_intent_id, total")
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED", "DISPUTED"].includes(order.status)) {
        return NextResponse.json({ error: "Cannot refund order in current status" }, { status: 400 });
      }

      if (!order.payment_intent_id) {
        return NextResponse.json({ error: "No payment intent for this order" }, { status: 400 });
      }

      const { data: ref, error: beginError } = await serviceClient.rpc("begin_refund", {
        p_order_id: orderId,
      });
      if (beginError || !ref) {
        return NextResponse.json({ error: beginError?.message || "Unable to initiate refund" }, { status: 500 });
      }

      let stripeRefund;
      try {
        stripeRefund = await stripe.refunds.create(
          {
            payment_intent: order.payment_intent_id,
            reason: "requested_by_customer",
            metadata: { order_id: orderId, admin_initiated: "true" },
          },
          { idempotencyKey: `refund:${orderId}` }
        );
      } catch (stripeErr) {
        console.error("[Admin resolve] Stripe refund failed:", stripeErr);
        return NextResponse.json({ error: "Refund initiated but Stripe outcome pending" }, { status: 500 });
      }

      const { error: bindError } = await serviceClient.rpc("bind_active_refund", {
        p_order_id: orderId,
        p_refund_id: stripeRefund.id,
      });
      if (bindError) {
        console.error("[Admin resolve] Bind failed:", bindError.message);
      }

      await serviceClient.from("refunds").insert({
        order_id: orderId,
        payment_intent_id: order.payment_intent_id,
        stripe_refund_id: stripeRefund.id,
        amount_cents: stripeRefund.amount,
        status: stripeRefund.status || "pending",
        is_full_refund: false,
        reason: "requested_by_customer",
      });

      await serviceClient.from("notifications").insert({
        user_id: order.buyer_id,
        type: "refund",
        title: "Reembolso procesado",
        message: "El administrador ha procesado un reembolso",
        data: { order_id: orderId },
        link: "/orders",
      });

      return NextResponse.json({ success: true, result: { order_id: orderId, status: "REFUND_PENDING", refund_id: stripeRefund.id } });
    }

    // type === "complete"
    const { error } = await serviceClient
      .from("orders")
      .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "DISPUTED");

    if (error) {
      console.error("[API /admin/disputes/resolve] complete error:", error.message);
      return NextResponse.json({ error: error.message || "Error completing order" }, { status: 500 });
    }

    const { data: orderInfo } = await serviceClient
      .from("orders").select("buyer_id, seller_id").eq("id", orderId).single();
    if (orderInfo) {
      await serviceClient.from("notifications").insert([
        { user_id: orderInfo.buyer_id, type: "order", title: "Disputa resuelta", message: "La disputa ha sido resuelta a favor del vendedor. Pedido completado.", data: { order_id: orderId }, link: "/orders" },
        { user_id: orderInfo.seller_id, type: "order", title: "Disputa resuelta", message: "La disputa ha sido resuelta a tu favor. Pedido completado.", data: { order_id: orderId }, link: "/orders" },
      ]);
    }

    return NextResponse.json({ success: true, result: { order_id: orderId, status: "COMPLETED" } });
  } catch (err) {
    console.error("[API /admin/disputes/resolve] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
