import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { ORDER_STATES, canTransitionOrder, normalizeOrderStatus } from "@/lib/orderStates";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function PATCH(req, { params }) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const supabase = createClient(url, key);

    const { data: existing } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, status")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    if (existing.buyer_id !== user.id && existing.seller_id !== user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const actorRole = existing.buyer_id === user.id ? "buyer" : "seller";
    const updates = {};
    const nextStatus = body.status ? normalizeOrderStatus(body.status) : null;
    if (nextStatus) {
      if (!canTransitionOrder(existing.status, nextStatus, actorRole)) {
        return NextResponse.json({ error: "Transición de estado no permitida" }, { status: 400 });
      }
      updates.status = nextStatus;
    }
    if (body.tracking_code) updates.tracking_code = body.tracking_code;
    if (nextStatus === ORDER_STATES.COMPLETED) updates.confirmed_at = new Date().toISOString();

    const { data, error: updateError } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    if (nextStatus === ORDER_STATES.COMPLETED) {
      const { data: sellerRow } = await supabase.from("users").select("sales").eq("id", existing.seller_id).single();
      if (sellerRow) {
        await supabase.from("users").update({ sales: (sellerRow.sales || 0) + 1 }).eq("id", existing.seller_id);
      }

      const { data: buyerRow } = await supabase.from("users").select("purchases").eq("id", existing.buyer_id).single();
      if (buyerRow) {
        await supabase.from("users").update({ purchases: (buyerRow.purchases || 0) + 1 }).eq("id", existing.buyer_id);
      }
    }

    const notifyUserId = user.id === existing.buyer_id ? existing.seller_id : existing.buyer_id;
    const statusLabels = {
      [ORDER_STATES.SHIPPED]: "ha enviado tu pedido",
      [ORDER_STATES.COMPLETED]: "ha confirmado la recepción",
    };
    if (statusLabels[nextStatus]) {
      await supabase.from("notifications").insert({
        user_id: notifyUserId,
        type: "order_update",
        title: "Actualización de pedido",
        body: statusLabels[nextStatus],
        link: "/orders",
      });
    }

    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error("Error updating order:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
