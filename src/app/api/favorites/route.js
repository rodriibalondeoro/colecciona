import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

// GET /api/favorites - get current user's favorites
export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "200", 10)));

    // RLS enforced: auth.uid() = user_id
    const supabase = createUserClient(token);
    const { data } = await supabase
      .from("favorites")
      .select("product_id")
      .eq("user_id", user.id)
      .limit(limit);

    return NextResponse.json({ favorites: (data || []).map(f => f.product_id) });
  } catch (err) {
    console.error("[Favorites] GET error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST /api/favorites - toggle favorite
export async function POST(req) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const rl = await rateLimit(`favorites:${ip}`, { limit: 20, windowMs: 60000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
  }

  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { productId } = body;

  // Validate productId is a valid UUID
  if (!productId || typeof productId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    return NextResponse.json({ error: "productId inválido" }, { status: 400 });
  }

  // RLS enforced: auth.uid() = user_id
  const supabase = createUserClient(token);

  const { data: existing, error: findError } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .single();

  if (findError && findError.code !== "PGRST116") {
    console.error("[Favorites] Find error:", findError.message);
    return NextResponse.json({ error: "Error consultando favoritos" }, { status: 500 });
  }

  if (existing) {
    const { error: deleteError } = await supabase.from("favorites").delete().eq("id", existing.id);
    if (deleteError) {
      console.error("[Favorites] Delete error:", deleteError.message);
      return NextResponse.json({ error: "Error eliminando favorito" }, { status: 500 });
    }
    return NextResponse.json({ favorited: false });
  } else {
    const { error: insertError } = await supabase.from("favorites").insert({ user_id: user.id, product_id: productId });
    if (insertError) {
      console.error("[Favorites] Insert error:", insertError.message);
      return NextResponse.json({ error: "Error añadiendo favorito" }, { status: 500 });
    }
    return NextResponse.json({ favorited: true });
  }
}
