import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ items: [] });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const from = (page - 1) * limit;

    let query = supabase
      .from("collection_items")
      .select("*", { count: "exact" })
      .eq("collection_id", id)
      .order("card_number", { ascending: true })
      .range(from, from + limit - 1);

    if (status) query = query.eq("status", status);
    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("card_name", `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ items: data || [], total: count || 0 });
  } catch (err) {
    console.error("[Collection Items GET]", err);
    return NextResponse.json({ items: [] });
  }
}

export async function POST(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    // Verify collection ownership
    const { data: collection } = await supabase
      .from("collections")
      .select("user_id")
      .eq("id", id)
      .single();

    if (!collection || collection.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const body = await req.json();
    const { card_name, card_number, card_code, set_name, category, image_url, status: itemStatus, total_quantity, notes, priority } = body;

    if (!card_name || !card_name.trim()) {
      return NextResponse.json({ error: "El nombre del cromo es obligatorio" }, { status: 400 });
    }

    const qty = Math.max(1, parseInt(total_quantity) || 1);
    let status = itemStatus || "OWNED";
    let ownedQty = 0;
    let dupQty = 0;
    let tradeQty = 0;
    let saleQty = 0;

    // Cumulative model: owned = total, duplicates = extras, trade/sale = subsets of duplicates
    switch (status) {
      case "OWNED": ownedQty = qty; break;
      case "MISSING": ownedQty = 0; break;
      case "DUPLICATE": ownedQty = qty; dupQty = qty; break;
      case "FOR_TRADE": ownedQty = qty; dupQty = qty; tradeQty = qty; break;
      case "FOR_SALE": ownedQty = qty; dupQty = qty; saleQty = qty; break;
      default: ownedQty = qty;
    }

    const priorityVal = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';

    // Use upsert for unique constraint
    const { data, error } = await supabase
      .from("collection_items")
      .upsert({
        collection_id: id,
        user_id: user.id,
        card_name: card_name.trim(),
        card_number: card_number || null,
        card_code: card_code || null,
        set_name: set_name || null,
        category: category || null,
        image_url: image_url || null,
        status,
        total_quantity: qty,
        owned_quantity: ownedQty,
        duplicate_quantity: dupQty,
        trade_quantity: tradeQty,
        sale_quantity: saleQty,
        notes: notes || null,
        priority: priorityVal,
      }, { onConflict: "collection_id,card_name,card_number" })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error("[Collection Items POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const body = await req.json();
    const { itemId, status, total_quantity, notes, priority } = body;

    if (!itemId) {
      return NextResponse.json({ error: "itemId requerido" }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from("collection_items")
      .select("user_id, collection_id")
      .eq("id", itemId)
      .single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const updates = {};
    if (status !== undefined) {
      updates.status = status;
      const qty = parseInt(total_quantity) || 1;
      updates.total_quantity = qty;
      // Cumulative model: owned = total, duplicates = extras, trade/sale = subsets
      switch (status) {
        case "OWNED": updates.owned_quantity = qty; updates.duplicate_quantity = 0; updates.trade_quantity = 0; updates.sale_quantity = 0; break;
        case "MISSING": updates.owned_quantity = 0; updates.duplicate_quantity = 0; updates.trade_quantity = 0; updates.sale_quantity = 0; break;
        case "DUPLICATE": updates.owned_quantity = qty; updates.duplicate_quantity = qty; updates.trade_quantity = 0; updates.sale_quantity = 0; break;
        case "FOR_TRADE": updates.owned_quantity = qty; updates.duplicate_quantity = qty; updates.trade_quantity = qty; updates.sale_quantity = 0; break;
        case "FOR_SALE": updates.owned_quantity = qty; updates.duplicate_quantity = qty; updates.trade_quantity = 0; updates.sale_quantity = qty; break;
      }
    }
    if (total_quantity !== undefined && status === undefined) {
      updates.total_quantity = parseInt(total_quantity) || 1;
    }
    if (notes !== undefined) updates.notes = notes;
    if (priority !== undefined && ['low', 'normal', 'high', 'urgent'].includes(priority)) {
      updates.priority = priority;
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("collection_items")
      .update(updates)
      .eq("id", itemId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error("[Collection Items PATCH]", err);
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

    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get("itemId");

    if (!itemId) {
      return NextResponse.json({ error: "itemId requerido" }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from("collection_items")
      .select("user_id")
      .eq("id", itemId)
      .single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const { error } = await supabase
      .from("collection_items")
      .delete()
      .eq("id", itemId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Collection Items DELETE]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
