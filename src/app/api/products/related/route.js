import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("id");
  const category = searchParams.get("category");
  const sellerId = searchParams.get("seller");

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ products: [] });

  let query = supabase
    .from("products")
    .select("*, seller:profiles!products_seller_fkey(username, name, avatar)")
    .neq("id", productId || "")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(8);

  if (sellerId) {
    query = query.eq("seller", sellerId);
  } else if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  return NextResponse.json({ products: data || [] });
}
