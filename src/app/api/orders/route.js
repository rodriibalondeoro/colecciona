import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

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
