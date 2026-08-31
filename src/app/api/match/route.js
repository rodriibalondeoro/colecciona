import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";
import { findMatches } from "@/lib/tradeMatching";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ matches: [] });

    // Get current user's FOR_TRADE items (what they offer)
    const { data: myOfferItems } = await supabase
      .from("collection_items")
      .select("card_name, card_number, status")
      .eq("user_id", user.id)
      .in("status", ["FOR_TRADE", "DUPLICATE"]);

    // Get current user's MISSING items (what they want)
    const { data: myMissingItems } = await supabase
      .from("collection_items")
      .select("card_name, card_number, status")
      .eq("user_id", user.id)
      .eq("status", "MISSING");

    const targetUser = {
      id: user.id,
      offers: (myOfferItems || []).map(i => i.card_name),
      wants: (myMissingItems || []).map(i => i.card_name),
    };

    if (!targetUser.offers.length && !targetUser.wants.length) {
      return NextResponse.json({ matches: [], hint: "Marca cromos como 'Falta' o 'Disponible para intercambio' para encontrar matches" });
    }

    // Get other users' items
    // Get all users who have FOR_TRADE or MISSING items
    const { data: otherOfferItems } = await supabase
      .from("collection_items")
      .select("user_id, card_name, status")
      .neq("user_id", user.id)
      .in("status", ["FOR_TRADE", "DUPLICATE"]);

    const { data: otherMissingItems } = await supabase
      .from("collection_items")
      .select("user_id, card_name, status")
      .neq("user_id", user.id)
      .eq("status", "MISSING");

    // Group by user
    const userOffers = {};
    const userWants = {};

    for (const item of otherOfferItems || []) {
      if (!userOffers[item.user_id]) userOffers[item.user_id] = [];
      userOffers[item.user_id].push(item.card_name);
    }

    for (const item of otherMissingItems || []) {
      if (!userWants[item.user_id]) userWants[item.user_id] = [];
      userWants[item.user_id].push(item.card_name);
    }

    // Get user info for potential matches
    const userIds = [...new Set([...Object.keys(userOffers), ...Object.keys(userWants)])];

    if (!userIds.length) {
      return NextResponse.json({ matches: [] });
    }

    const { data: users } = await supabase
      .from("users")
      .select("id, name, username, avatar_url, rating, public_location")
      .in("id", userIds);

    const userMap = {};
    for (const u of users || []) {
      userMap[u.id] = u;
    }

    // Build other users array for matching
    const otherUsers = userIds.map(uid => ({
      id: uid,
      name: userMap[uid]?.name,
      username: userMap[uid]?.username,
      avatar_url: userMap[uid]?.avatar_url,
      offers: userOffers[uid] || [],
      wants: userWants[uid] || [],
    }));

    const matches = findMatches(targetUser, otherUsers, { minScore: 10, maxResults: 20 });

    return NextResponse.json({
      matches,
      myOffers: targetUser.offers.length,
      myWants: targetUser.wants.length,
    });
  } catch (err) {
    console.error("[Match GET]", err);
    return NextResponse.json({ matches: [] });
  }
}
