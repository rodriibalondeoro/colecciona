import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`order:${ip}`, { limit: 5, windowMs: 60000 });
    if (!rl.allowed) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

    const { productIds, shippingMethod, shippingAddress } = await req.json();
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    // 1. Reserve products
    const reservedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: reserveError } = await supabase.rpc("reserve_products_for_checkout", {
      p_product_ids: productIds,
      p_buyer_id: user.id,
      p_reserved_until: reservedUntil,
    });
    if (reserveError) {
      return NextResponse.json({ error: "Uno o más productos no están disponibles" }, { status: 409 });
    }

    // 2. Create order via RPC (server-calculates all prices)
    const { data: orderResult, error: orderError } = await supabase.rpc("create_checkout_order", {
      p_product_ids: productIds,
      p_shipping_method: shippingMethod || "standard",
      p_shipping_address: shippingAddress || "",
    });
    if (orderError || !orderResult) {
      return NextResponse.json({ error: "Error creando el pedido" }, { status: 500 });
    }

    return NextResponse.json({ success: true, order: orderResult });
  } catch (err) {
    console.error("Error creating order:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ orders: [] });

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ orders: [] });

    const { data } = await supabase
      .from("orders")
      .select(`
        *,
        items:order_items(id, product_id, price, product:products(id, title, image)),
        seller:profiles!orders_seller_id_fkey(name, username),
        buyer:profiles!orders_buyer_id_fkey(name, username)
      `)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    return NextResponse.json({ orders: data || [] });
  } catch (err) {
    console.error("Error fetching orders:", err);
    return NextResponse.json({ orders: [] });
  }
}
