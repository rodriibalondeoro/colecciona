import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim().slice(0, 100);
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") || "8", 10)));

    if (!q) {
      return NextResponse.json({ success: true, users: [] });
    }

    if (!url || !anonKey) {
      console.error("[Users Search] Supabase not configured");
      return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });
    }

    // Public search: use anon key (RLS allows public SELECT on profiles)
    const supabase = createClient(url, anonKey);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, name, avatar, sales, purchases, rating, location, followers, following")
      .or(`username.ilike.%${q}%,name.ilike.%${q}%`)
      .order("sales", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[Users Search] Supabase error:", error.message);
      return NextResponse.json({ users: [] });
    }

    return NextResponse.json({ success: true, users: data || [] });
  } catch (error) {
    console.error("[Users Search] Error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
