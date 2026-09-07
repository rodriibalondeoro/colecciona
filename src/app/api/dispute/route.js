import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const rl = await rateLimit(`dispute:${user.id}`, { limit: 3, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { orderId, reason } = body;

    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const supabase = createClient(url, key);

    // Verify order exists and user is buyer
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, status")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.buyer_id !== user.id) {
      return NextResponse.json({ error: "Solo el comprador puede abrir una disputa" }, { status: 403 });
    }

    if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED"].includes(order.status)) {
      return NextResponse.json({ error: "No se puede abrir disputa para esta orden" }, { status: 400 });
    }

    // Transition order to DISPUTED via service_role (auth.uid() check bypassed)
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "DISPUTED" })
      .eq("id", orderId)
      .eq("status", order.status);

    if (updateError) {
      console.error("[API /dispute] Error:", updateError.message);
      return NextResponse.json({ error: "Error al abrir disputa" }, { status: 500 });
    }

    // Notify seller
    await supabase.from("notifications").insert({
      user_id: order.seller_id,
      type: "dispute",
      title: "Disputa abierta",
      message: `El comprador ha abierto una disputa: ${reason.substring(0, 150)}`,
      data: { order_id: orderId },
      link: "/orders",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API /dispute] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
