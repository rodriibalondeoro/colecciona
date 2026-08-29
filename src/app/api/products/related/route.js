import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("id");
  const category = searchParams.get("category");

  if (!url || !key) return NextResponse.json({ products: [] });

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("products")
    .select("*, seller:users(username, name, initials)")
    .neq("id", productId || "")
    .eq("category", category || "")
    .order("created_at", { ascending: false })
    .limit(8);

  return NextResponse.json({ products: data || [] });
}
