import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// GET /api/favorites - get current user's favorites
export async function GET(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ favorites: [] });

  const supabase = createClient(url, serviceKey);
  const { data } = await supabase
    .from("favorites")
    .select("product_id")
    .eq("user_id", user.id);

  return NextResponse.json({ favorites: (data || []).map(f => f.product_id) });
}

// POST /api/favorites - toggle favorite
export async function POST(req) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const rl = rateLimit(`favorites:${ip}`, { limit: 20, windowMs: 60000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
  }

  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  
  const { productId } = await req.json();
  const supabase = createClient(url, serviceKey);
  
  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .single();
  
  if (existing) {
    await supabase.from("favorites").delete().eq("id", existing.id);
    return NextResponse.json({ favorited: false });
  } else {
    await supabase.from("favorites").insert({ user_id: user.id, product_id: productId });
    return NextResponse.json({ favorited: true });
  }
}
