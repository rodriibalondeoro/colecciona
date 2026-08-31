import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("id");
  const category = searchParams.get("category");

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ products: [] });

  const { data, error } = await supabase
    .from("products")
    .select("*, seller:users(username, name, initials)")
    .neq("id", productId || "")
    .eq("category", category || "")
    .order("created_at", { ascending: false })
    .limit(8);

  return NextResponse.json({ products: data || [] });
}
