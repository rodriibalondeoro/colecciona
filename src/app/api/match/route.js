import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";
import { findMatches, itemToKey } from "@/lib/tradeMatching";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ matches: [], error: "Supabase not configured" }, { status: 503 });

    // Get current user's items with trade_quantity > 0 (what they offer)
    const { data: myOfferItems } = await supabase
      .from("collection_items")
      .select("card_name, card_number, set_name, trade_quantity")
      .eq("user_id", user.id)
      .gt("trade_quantity", 0);

    // Get current user's MISSING items (what they want)
    const { data: myMissingItems } = await supabase
      .from("collection_items")
      .select("card_name, card_number, set_name")
      .eq("user_id", user.id)
      .eq("status", "MISSING");

    // Build offers with composite keys and quantities
    const myOffers = (myOfferItems || []).map(item => ({
      key: itemToKey(item),
      quantity: item.trade_quantity || 1,
    }));

    const myWants = (myMissingItems || []).map(item => itemToKey(item));

    const targetUser = {
      id: user.id,
      offers: myOffers,
      wants: myWants,
    };

    if (!myOffers.length && !myWants.length) {
      return NextResponse.json({
        matches: [],
        hint: "Marca cromos como 'Falta' o 'Disponible para intercambio' para encontrar matches",
      });
    }

    // Get other users' items with trade_quantity > 0 (actual offers)
    const { data: otherOfferItems } = await supabase
      .from("collection_items")
      .select("user_id, card_name, card_number, set_name, trade_quantity")
      .neq("user_id", user.id)
      .gt("trade_quantity", 0);

    // Get other users' MISSING items (what they want)
    const { data: otherMissingItems } = await supabase
      .from("collection_items")
      .select("user_id, card_name, card_number, set_name")
      .neq("user_id", user.id)
      .eq("status", "MISSING");

    // Group by user with composite keys and quantities
    const userOffers = {};
    const userWants = {};

    for (const item of otherOfferItems || []) {
      if (!userOffers[item.user_id]) userOffers[item.user_id] = [];
      userOffers[item.user_id].push({
        key: itemToKey(item),
        quantity: item.trade_quantity || 1,
      });
    }

    for (const item of otherMissingItems || []) {
      if (!userWants[item.user_id]) userWants[item.user_id] = [];
      userWants[item.user_id].push(itemToKey(item));
    }

    // Get unique user IDs
    const userIds = [...new Set([...Object.keys(userOffers), ...Object.keys(userWants)])];

    if (!userIds.length) {
      return NextResponse.json({ matches: [] });
    }

    // Fetch user profiles (batch in groups of 100 to avoid IN clause limits)
    const BATCH_SIZE = 100;
    const users = [];
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const { data: batchUsers } = await supabase
        .from("profiles")
        .select("id, name, username, avatar, rating, location")
        .in("id", batch);
      if (batchUsers) users.push(...batchUsers);
    }

    const userMap = {};
    for (const u of users || []) {
      userMap[u.id] = u;
    }

    // Build other users array for matching
    const otherUsers = userIds.map(uid => ({
      id: uid,
      name: userMap[uid]?.name,
      username: userMap[uid]?.username,
      avatar: userMap[uid]?.avatar,
      rating: userMap[uid]?.rating || 0,
      location: userMap[uid]?.location || "",
      offers: userOffers[uid] || [],
      wants: userWants[uid] || [],
    }));

    // Get current user's location for proximity scoring
    const { data: me } = await supabase
      .from("profiles")
      .select("location")
      .eq("id", user.id)
      .single();

    const matches = findMatches(targetUser, otherUsers, {
      minScore: 10,
      maxResults: 20,
      userLocation: me?.location || "",
    });

    return NextResponse.json({
      matches,
      myOffers: myOffers.length,
      myWants: myWants.length,
    });
  } catch (err) {
    console.error("[Match GET]", err);
    return NextResponse.json({ matches: [], error: "Error interno" }, { status: 500 });
  }
}
