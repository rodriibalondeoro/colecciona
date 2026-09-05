import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_VISIBILITY = ["public", "followers", "private"];

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (userId && typeof userId === "string" && !UUID_RE.test(userId)) {
      return NextResponse.json({ error: "userId inválido" }, { status: 400 });
    }

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const { user } = await verifyAuth(req);

    if (!userId) {
      if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      const token = extractToken(req);
      if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

      const supabase = createUserClient(token);
      const { data, error, count } = await supabase
        .from("collections")
        .select("*, item_count:collection_items(count)", { count: "exact" })
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (error) {
        console.error("[Collections] Supabase error:", error.message);
        return NextResponse.json({ error: "Error loading collections" }, { status: 500 });
      }

      return NextResponse.json({ collections: data || [], total: count || 0, page, limit });
    }

    const token = extractToken(req);
    const supabase = token
      ? createUserClient(token)
      : (await import("@supabase/supabase-js")).createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

    const { data, error } = await supabase.rpc("get_visible_collections", {
      p_owner_id: userId,
      p_page: page,
      p_limit: limit,
    });

    if (error) {
      console.error("[Collections] RPC error:", error.message);
      return NextResponse.json({ error: "Error loading collections" }, { status: 500 });
    }

    return NextResponse.json(data || { collections: [], total: 0, page, limit });
  } catch (err) {
    console.error("[Collections] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const rl = await rateLimit(`collections:${user.id}`, { limit: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { name, description, category, subcategory, cover_image, year, publisher, total_items, visibility } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }
    if (visibility && !ALLOWED_VISIBILITY.includes(visibility)) {
      return NextResponse.json({ error: "Visibilidad no válida" }, { status: 400 });
    }
    if (year !== undefined && year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
      return NextResponse.json({ error: "Año inválido" }, { status: 400 });
    }
    if (total_items !== undefined && (!Number.isInteger(total_items) || total_items < 0)) {
      return NextResponse.json({ error: "total_items inválido" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: user.id,
        name: name.trim().slice(0, 100),
        description: String(description || "").slice(0, 500),
        category: String(category || "").slice(0, 50),
        subcategory: String(subcategory || "").slice(0, 50),
        cover_image: String(cover_image || "").slice(0, 500),
        year: year || null,
        publisher: String(publisher || "").slice(0, 100),
        total_items: total_items || 0,
        visibility: visibility || "private",
      })
      .select()
      .single();

    if (error) {
      console.error("[Collections] Insert error:", error.message);
      return NextResponse.json({ error: "Error creating collection" }, { status: 500 });
    }

    return NextResponse.json({ collection: data });
  } catch (err) {
    console.error("[Collections] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
