import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

const MAX_ITEMS = 100;
const MAX_SELLERS = 20;

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const cardName = searchParams.get("card_name");
    if (!cardName || typeof cardName !== "string" || cardName.trim().length === 0) {
      return NextResponse.json({ error: "card_name requerido" }, { status: 400 });
    }

    if (cardName.length > 200) {
      return NextResponse.json({ error: "card_name demasiado largo" }, { status: 400 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const { data: items, error: itemsError } = await supabase
      .from("collection_items")
      .select("user_id, card_name, card_number, set_name, duplicate_quantity, status")
      .neq("user_id", user.id)
      .ilike("card_name", cardName)
      .in("status", ["FOR_TRADE", "FOR_SALE"])
      .limit(MAX_ITEMS);

    if (itemsError) {
      console.error("[WhoHasIt] Items query error:", itemsError.message);
      return NextResponse.json({ error: "Error searching cards" }, { status: 500 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ sellers: [] });
    }

    const userIds = [...new Set(items.map(i => i.user_id))].slice(0, MAX_SELLERS);

    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, name, username, avatar, rating, location")
      .in("id", userIds);

    if (usersError) {
      console.error("[WhoHasIt] Profiles query error:", usersError.message);
      return NextResponse.json({ error: "Error loading sellers" }, { status: 500 });
    }

    const userMap = {};
    for (const u of users || []) {
      userMap[u.id] = u;
    }

    const sellers = userIds.map(uid => ({
      user: userMap[uid] || { id: uid, name: "Usuario" },
      items: items.filter(i => i.user_id === uid),
    }));

    return NextResponse.json({ sellers });
  } catch (err) {
    console.error("[WhoHasIt GET]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
