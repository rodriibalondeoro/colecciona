import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const cardName = searchParams.get("card_name");
    if (!cardName) {
      return NextResponse.json({ error: "card_name requerido" }, { status: 400 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ sellers: [] });

    const { data: items } = await supabase
      .from("collection_items")
      .select("user_id, card_name, card_number, set_name, quantity, status")
      .neq("user_id", user.id)
      .ilike("card_name", cardName)
      .in("status", ["FOR_TRADE", "FOR_SALE"]);

    if (!items || items.length === 0) {
      return NextResponse.json({ sellers: [] });
    }

    const userIds = [...new Set(items.map(i => i.user_id))];
    const { data: users } = await supabase
      .from("profiles")
      .select("id, name, username, avatar, rating, location")
      .in("id", userIds);

    const userMap = {};
    for (const u of users || []) {
      userMap[u.id] = u;
    }

    const sellers = userIds.map(uid => ({
      user: userMap[uid],
      items: items.filter(i => i.user_id === uid),
    }));

    return NextResponse.json({ sellers });
  } catch (err) {
    console.error("[WhoHasIt GET]", err);
    return NextResponse.json({ sellers: [] });
  }
}
