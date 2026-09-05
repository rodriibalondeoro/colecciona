import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ITEM_STATUS = ["OWNED", "MISSING", "DUPLICATE", "FOR_TRADE", "FOR_SALE"];

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const token = extractToken(req);
    const supabase = token
      ? createUserClient(token)
      : (await import("@supabase/supabase-js")).createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

    // Visibility check
    const { data: collection, error: colError } = await supabase
      .from("collections").select("user_id, visibility").eq("id", id).single();

    if (colError || !collection) return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });

    const { user } = await verifyAuth(req);

    if (collection.visibility === "private") {
      if (!user || user.id !== collection.user_id) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    } else if (collection.visibility === "followers") {
      if (!user) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      if (user.id !== collection.user_id) {
        const { data: follow } = await supabase
          .from("follows").select("id")
          .eq("follower_id", user.id).eq("following_id", collection.user_id).maybeSingle();
        if (!follow) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
    const from = (page - 1) * limit;

    if (status && !ALLOWED_ITEM_STATUS.includes(status)) {
      return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    }

    let query = supabase
      .from("collection_items")
      .select("*", { count: "exact" })
      .eq("collection_id", id)
      .order("card_number", { ascending: true })
      .range(from, from + limit - 1);

    if (status) query = query.eq("status", status);
    if (search) query = query.ilike("card_name", `%${search.slice(0, 100)}%`);

    const { data, error, count } = await query;
    if (error) {
      console.error("[Collection Items] Supabase error:", error.message);
      return NextResponse.json({ error: "Error loading items" }, { status: 500 });
    }

    return NextResponse.json({ items: data || [], total: count || 0 });
  } catch (err) {
    console.error("[Collection Items GET]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`collection-items:${ip}`, { limit: 20, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID de colección inválido" }, { status: 400 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { data: collection } = await supabase
      .from("collections").select("user_id").eq("id", id).single();

    if (!collection || collection.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { card_name, card_number, card_code, set_name, category, image_url, status: itemStatus, total_quantity, notes, priority } = body;

    if (!card_name || typeof card_name !== "string" || !card_name.trim()) {
      return NextResponse.json({ error: "El nombre del cromo es obligatorio" }, { status: 400 });
    }

    if (!ALLOWED_ITEM_STATUS.includes(itemStatus)) {
      return NextResponse.json({ error: `Estado no válido: ${itemStatus}` }, { status: 400 });
    }

    const status = itemStatus;
    const qty = Math.max(1, parseInt(total_quantity) || 1);
    let ownedQty = 0, dupQty = 0, tradeQty = 0, saleQty = 0;

    switch (status) {
      case "OWNED": ownedQty = qty; break;
      case "MISSING": ownedQty = 0; break;
      case "DUPLICATE": ownedQty = qty; dupQty = qty; break;
      case "FOR_TRADE": ownedQty = qty; dupQty = qty; tradeQty = qty; break;
      case "FOR_SALE": ownedQty = qty; dupQty = qty; saleQty = qty; break;
    }

    const priorityVal = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';

    const { data, error } = await supabase
      .from("collection_items")
      .upsert({
        collection_id: id, user_id: user.id,
        card_name: card_name.trim().slice(0, 200),
        card_number: String(card_number || "").slice(0, 50),
        card_code: String(card_code || "").slice(0, 50),
        set_name: String(set_name || "").slice(0, 100),
        category: String(category || "").slice(0, 50),
        image_url: String(image_url || "").slice(0, 500),
        status, total_quantity: qty, owned_quantity: ownedQty,
        duplicate_quantity: dupQty, trade_quantity: tradeQty, sale_quantity: saleQty,
        notes: String(notes || "").slice(0, 1000),
        priority: priorityVal,
      }, { onConflict: "collection_id,card_name,card_number" })
      .select().single();

    if (error) {
      console.error("[Collection Items POST] Error:", error.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error("[Collection Items POST]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`collection-items:${ip}`, { limit: 20, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { itemId, status, total_quantity, notes, priority } = body;

    if (!itemId || typeof itemId !== "string" || !UUID_RE.test(itemId)) {
      return NextResponse.json({ error: "itemId inválido" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("collection_items").select("user_id").eq("id", itemId).single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const updates = {};
    if (status !== undefined) {
      if (!ALLOWED_ITEM_STATUS.includes(status)) {
        return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
      }
      const qty = Math.max(1, parseInt(total_quantity) || 1);
      updates.status = status;
      updates.total_quantity = qty;
      switch (status) {
        case "OWNED": updates.owned_quantity = qty; updates.duplicate_quantity = 0; updates.trade_quantity = 0; updates.sale_quantity = 0; break;
        case "MISSING": updates.owned_quantity = 0; updates.total_quantity = 0; updates.duplicate_quantity = 0; updates.trade_quantity = 0; updates.sale_quantity = 0; break;
        case "DUPLICATE": updates.owned_quantity = qty; updates.duplicate_quantity = qty; updates.trade_quantity = 0; updates.sale_quantity = 0; break;
        case "FOR_TRADE": updates.owned_quantity = qty; updates.duplicate_quantity = qty; updates.trade_quantity = qty; updates.sale_quantity = 0; break;
        case "FOR_SALE": updates.owned_quantity = qty; updates.duplicate_quantity = qty; updates.trade_quantity = 0; updates.sale_quantity = qty; break;
      }
    }
    if (notes !== undefined) updates.notes = String(notes || "").slice(0, 1000);
    if (priority !== undefined && ['low', 'normal', 'high', 'urgent'].includes(priority)) {
      updates.priority = priority;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay cambios" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("collection_items").update(updates).eq("id", itemId).select().single();

    if (error) {
      console.error("[Collection Items PATCH] Error:", error.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error("[Collection Items PATCH]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`collection-items:${ip}`, { limit: 20, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);
    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get("itemId");

    if (!itemId || typeof itemId !== "string" || !UUID_RE.test(itemId)) {
      return NextResponse.json({ error: "itemId inválido" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("collection_items").select("user_id").eq("id", itemId).single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    // Block deletion if item has active trade proposals
    const { data: activeItems } = await supabase
      .from("trade_proposal_items")
      .select("id, trade_proposals!inner(status)")
      .eq("collection_item_id", itemId)
      .in("trade_proposals.status", ["PROPOSED", "ACCEPTED", "SHIPPING_PENDING", "SHIPPED", "RECEIVED"])
      .limit(1);

    if (activeItems && activeItems.length > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene propuestas de intercambio activas" }, { status: 409 });
    }

    const { error } = await supabase.from("collection_items").delete().eq("id", itemId);
    if (error) {
      console.error("[Collection Items DELETE] Error:", error.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Collection Items DELETE]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
