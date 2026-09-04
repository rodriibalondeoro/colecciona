import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req, { params }) {
  try {
    const { id } = await params;
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

    // Check visibility
    const { user } = await verifyAuth(req);

    if (collection.visibility === "private") {
      if (!user || user.id !== collection.user_id) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    } else if (collection.visibility === "followers") {
      if (!user) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
      if (user.id !== collection.user_id) {
        // Check if requester is a follower
        const { data: follow } = await supabase
          .from("follows")
          .select("id")
          .eq("follower_id", user.id)
          .eq("following_id", collection.user_id)
          .maybeSingle();
        if (!follow) {
          return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
        }
      }
    }
    // public → no check needed

    // Get items
    const { data: items } = await supabase
      .from("collection_items")
      .select("*")
      .eq("collection_id", id)
      .order("card_number", { ascending: true });

    // Compute stats
    const owned = (items || []).filter(i => i.status === "OWNED" || i.status === "DUPLICATE" || i.status === "FOR_TRADE" || i.status === "FOR_SALE");
    const missing = (items || []).filter(i => i.status === "MISSING");
    const duplicates = (items || []).filter(i => i.status === "DUPLICATE" || i.status === "FOR_TRADE" || i.status === "FOR_SALE");
    const totalOwned = owned.reduce((sum, i) => sum + (i.owned_quantity || 0), 0);
    const totalMissing = missing.length;
    const totalDuplicates = duplicates.reduce((sum, i) => sum + (i.duplicate_quantity || 0), 0);

    const progress = collection.total_items > 0
      ? Math.round((owned.length / collection.total_items) * 100)
      : 0;

    return NextResponse.json({
      collection: {
        ...collection,
        items: items || [],
        stats: {
          owned: owned.length,
          missing: totalMissing,
          duplicates: totalDuplicates,
          totalOwned,
          progress,
        },
      },
    });
  } catch (err) {
    console.error("[Collection Detail GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    // Verify ownership
    const { data: existing } = await supabase
      .from("collections")
      .select("user_id")
      .eq("id", id)
      .single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const body = await req.json();
    const { name, description, category, subcategory, cover_image, year, publisher, total_items, visibility } = body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (subcategory !== undefined) updates.subcategory = subcategory;
    if (cover_image !== undefined) updates.cover_image = cover_image;
    if (year !== undefined) updates.year = year;
    if (publisher !== undefined) updates.publisher = publisher;
    if (total_items !== undefined) updates.total_items = total_items;
    if (visibility !== undefined) updates.visibility = visibility;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("collections")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ collection: data });
  } catch (err) {
    console.error("[Collection PUT]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    // Verify ownership
    const { data: existing } = await supabase
      .from("collections")
      .select("user_id")
      .eq("id", id)
      .single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    // Block deletion if collection has items with active trade proposals
    const { data: items } = await supabase
      .from("collection_items")
      .select("id")
      .eq("collection_id", id);

    if (items && items.length > 0) {
      const { data: activeItems } = await supabase
        .from("trade_proposal_items")
        .select("id, trade_proposals!inner(status)")
        .in("collection_item_id", items.map(i => i.id))
        .in("trade_proposals.status", ["PROPOSED", "ACCEPTED", "SHIPPING_PENDING", "SHIPPED", "RECEIVED"])
        .limit(1);

      if (activeItems && activeItems.length > 0) {
        return NextResponse.json(
          { error: "No se puede eliminar: tiene propuestas de intercambio activas" },
          { status: 409 }
        );
      }
    }

    const { error } = await supabase
      .from("collections")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Collection DELETE]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
