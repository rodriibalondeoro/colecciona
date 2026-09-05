import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_VISIBILITY = ["public", "followers", "private"];

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const { data: collection, error } = await supabase
      .from("collections")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !collection) {
      return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });
    }

    const { user } = await verifyAuth(req);

    if (collection.visibility === "private") {
      if (!user || user.id !== collection.user_id) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    } else if (collection.visibility === "followers") {
      if (!user) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      if (user.id !== collection.user_id) {
        const { data: follow } = await supabase
          .from("follows").select("id")
          .eq("follower_id", user.id).eq("following_id", collection.user_id)
          .maybeSingle();
        if (!follow) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    }

    // Get items with limit
    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "200", 10) || 200));
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const from = (page - 1) * limit;

    const { data: items } = await supabase
      .from("collection_items")
      .select("*", { count: "exact" })
      .eq("collection_id", id)
      .order("card_number", { ascending: true })
      .range(from, from + limit - 1);

    // Compute stats from returned items
    const owned = (items || []).filter(i => ["OWNED", "DUPLICATE", "FOR_TRADE", "FOR_SALE"].includes(i.status));
    const missing = (items || []).filter(i => i.status === "MISSING");
    const duplicates = (items || []).filter(i => ["DUPLICATE", "FOR_TRADE", "FOR_SALE"].includes(i.status));
    const totalOwned = owned.reduce((sum, i) => sum + (i.owned_quantity || 0), 0);
    const totalMissing = missing.length;
    const totalDuplicates = duplicates.reduce((sum, i) => sum + (i.duplicate_quantity || 0), 0);
    const progress = collection.total_items > 0 ? Math.round((owned.length / collection.total_items) * 100) : 0;

    return NextResponse.json({
      collection: {
        ...collection,
        items: items || [],
        stats: { owned: owned.length, missing: totalMissing, duplicates: totalDuplicates, totalOwned, progress },
      },
    });
  } catch (err) {
    console.error("[Collection Detail GET]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { name, description, category, subcategory, cover_image, year, publisher, total_items, visibility } = body;

    const updates = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
      updates.name = name.trim().slice(0, 100);
    }
    if (description !== undefined) updates.description = String(description || "").slice(0, 500);
    if (category !== undefined) updates.category = String(category || "").slice(0, 50);
    if (subcategory !== undefined) updates.subcategory = String(subcategory || "").slice(0, 50);
    if (cover_image !== undefined) updates.cover_image = String(cover_image || "").slice(0, 500);
    if (year !== undefined) {
      if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
        return NextResponse.json({ error: "Año inválido" }, { status: 400 });
      }
      updates.year = year;
    }
    if (publisher !== undefined) updates.publisher = String(publisher || "").slice(0, 100);
    if (total_items !== undefined) {
      if (!Number.isInteger(total_items) || total_items < 0) {
        return NextResponse.json({ error: "total_items inválido" }, { status: 400 });
      }
      updates.total_items = total_items;
    }
    if (visibility !== undefined) {
      if (!ALLOWED_VISIBILITY.includes(visibility)) {
        return NextResponse.json({ error: "Visibilidad no válida" }, { status: 400 });
      }
      updates.visibility = visibility;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay cambios" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("collections").update(updates).eq("id", id).select().single();

    if (error) {
      console.error("[Collection PUT] Error:", error.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    return NextResponse.json({ collection: data });
  } catch (err) {
    console.error("[Collection PUT]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { data: existing } = await supabase
      .from("collections").select("user_id").eq("id", id).single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    // Block deletion if collection has items with active trade proposals
    const { data: items } = await supabase
      .from("collection_items").select("id").eq("collection_id", id);

    if (items && items.length > 0) {
      const { data: activeItems } = await supabase
        .from("trade_proposal_items")
        .select("id, trade_proposals!inner(status)")
        .in("collection_item_id", items.map(i => i.id))
        .in("trade_proposals.status", ["PROPOSED", "ACCEPTED", "SHIPPING_PENDING", "SHIPPED", "RECEIVED"])
        .limit(1);

      if (activeItems && activeItems.length > 0) {
        return NextResponse.json({ error: "No se puede eliminar: tiene propuestas de intercambio activas" }, { status: 409 });
      }
    }

    const { error } = await supabase.from("collections").delete().eq("id", id);
    if (error) {
      console.error("[Collection DELETE] Error:", error.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Collection DELETE]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
