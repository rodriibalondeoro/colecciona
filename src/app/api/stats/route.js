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

    const [{ count: totalProducts }, { data: sellers }, { count: salesToday }] = await Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("products").select("seller"),
      supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", startToday.toISOString()),
    ]);

    const activeSellers = (sellers || []).filter(
      (r, i, arr) => arr.findIndex((x) => x.seller === r.seller) === i
    ).length;

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
