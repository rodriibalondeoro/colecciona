import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        items:order_items(id, product_id, price, product:products(id, title, image)),
        seller:profiles!orders_seller_id_fkey(name, username),
        buyer:profiles!orders_buyer_id_fkey(name, username)
      `)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Orders] Supabase error:", error.message);
      return NextResponse.json({ error: "Error loading orders" }, { status: 500 });
    }

    return NextResponse.json({ orders: data || [] });
  } catch (err) {
    console.error("[Orders] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
