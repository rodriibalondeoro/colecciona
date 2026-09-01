import { NextResponse } from "next/server";
import { users } from "@/data/mockData";
import { createClient } from "@supabase/supabase-js";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") || "8", 10)));

    if (!q) {
      return NextResponse.json({ success: true, users: [] });
    }

    const ql = q.toLowerCase();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let dbUsers = [];

    if (url && key) {
      const supabase = createClient(url, key);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, name, avatar, sales, purchases, rating, location, followers, following")
        .or(`username.ilike.%${q}%,name.ilike.%${q}%`)
        .order("sales", { ascending: false })
        .limit(limit);

      if (!error && data) {
        dbUsers = data.map((u) => ({ ...u, id: String(u.id) }));
      } else {
        console.warn("Falló búsqueda de usuarios en Supabase:", error);
      }
    }

    // Fusiona usuarios reales + mock (demo), sin duplicados por username.
    const merged = [];
    const seen = new Set();
    const push = (u) => {
      const key = (u.username || "").toLowerCase();
      if (!key || seen.has(key)) return;
      const matches =
        (u.username || "").toLowerCase().includes(ql) ||
        (u.name || "").toLowerCase().includes(ql);
      if (!matches) return;
      seen.add(key);
      merged.push(u);
    };

    for (const u of dbUsers) push(u);
    for (const u of users) push(u);

    return NextResponse.json({ success: true, users: merged.slice(0, limit) });
  } catch (error) {
    console.error("Error en Users Search API:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
