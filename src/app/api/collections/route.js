import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ collections: [] });

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const from = (page - 1) * limit;

    const { user } = await verifyAuth(req);

    let query = supabase
      .from("collections")
      .select("*, item_count:collection_items(count)", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, from + limit - 1);

    if (userId) {
      // Viewing another user's collections — apply visibility rules
      if (user && user.id === userId) {
        // Owner sees all their own collections
        query = query.eq("user_id", userId);
      } else if (user) {
        // Authenticated user viewing someone else: public + followers (if following)
        query = query
          .eq("user_id", userId)
          .or(`visibility.eq.public,and(visibility.eq.followers,exists(select 1 from follows where follower_id = '${user.id}' and following_id = '${userId}'))`);
      } else {
        // Unauthenticated: only public
        query = query.eq("user_id", userId).eq("visibility", "public");
      }
    } else if (user) {
      // No userId param: show own collections
      query = query.eq("user_id", user.id);
    } else {
      // No userId, no auth: only public
      query = query.eq("visibility", "public");
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ collections: data || [], total: count || 0, page, limit });
  } catch (err) {
    console.error("[Collections GET]", err);
    return NextResponse.json({ collections: [], total: 0 });
  }
}

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

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

    if (error) throw error;

    return NextResponse.json({ collection: data });
  } catch (err) {
    console.error("[Collections POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
