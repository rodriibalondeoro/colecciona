import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));

    const { user } = await verifyAuth(req);

    if (!userId) {
      // No userId: show own collections (auth required)
      if (!user) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      }
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

    // Viewing someone's collections — RPC handles visibility logic
    const token = extractToken(req);
    const supabase = token
      ? createUserClient(token)
      : (await import("@supabase/supabase-js")).createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

    const { data, error } = await supabase.rpc("get_visible_collections", {
      p_owner_id: userId,
      p_requester_id: user?.id || null,
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
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const body = await req.json();
    const { name, description, category, subcategory, cover_image, year, publisher, total_items, visibility } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: user.id,
        name: name.trim(),
        description: description || null,
        category: category || null,
        subcategory: subcategory || null,
        cover_image: cover_image || null,
        year: year || null,
        publisher: publisher || null,
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
