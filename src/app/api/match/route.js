import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    // Use SQL RPC — avoids loading global inventory into Node.js
    const { data: matches, error: rpcError } = await supabase.rpc("find_user_matches", {
      p_user_id: user.id,
      p_max_results: 20,
    });

    if (rpcError) {
      console.error("[Match] RPC error:", rpcError.message);
      return NextResponse.json({ matches: [], error: "Error finding matches" }, { status: 500 });
    }

    // Enrich with profile data for the matched users
    const userIds = (matches || []).map(m => m.user_id).filter(Boolean);
    let profiles = [];
    if (userIds.length > 0) {
      const { data, error: profilesError } = await supabase
        .from("profiles")
        .select("id, name, username, avatar, rating, location")
        .in("id", userIds);
      if (profilesError) {
        console.error("[Match] Profiles error:", profilesError.message);
      }
      profiles = data || [];
    }

    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

    const enriched = (matches || []).map(m => ({
      user: profileMap[m.user_id] || { id: m.user_id, name: "Usuario" },
      giveCount: m.give_count,
      getCount: m.get_count,
      score: m.score,
      giveItems: m.give_items || [],
      getItems: m.get_items || [],
    }));

    return NextResponse.json({ matches: enriched });
  } catch (err) {
    console.error("[Match GET]", err);
    return NextResponse.json({ matches: [], error: "Error interno" }, { status: 500 });
  }
}
