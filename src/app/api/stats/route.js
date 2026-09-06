import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json({ totalProducts: 0, activeSellers: 0, salesToday: 0 });
    }

    const supabase = createClient(url, key);
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    const [{ count: totalProducts }, { data: sellersData }, { count: salesToday }] = await Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.rpc("count_active_sellers"),
      supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", startToday.toISOString()),
    ]);

    const activeSellers = Number(sellersData) || 0;

    return NextResponse.json({
      totalProducts: totalProducts || 0,
      activeSellers,
      salesToday: salesToday || 0,
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    return NextResponse.json({ totalProducts: 0, activeSellers: 0, salesToday: 0 });
  }
}
