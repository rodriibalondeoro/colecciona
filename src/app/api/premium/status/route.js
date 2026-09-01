import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req) {
  const fallback = { isPremium: false, premiumSince: null, commissionRate: 0.08 };
  try {
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json(fallback);

    const { user } = await verifyAuth(req);
    if (!user) {
      return NextResponse.json({
        isPremium: false,
        premiumSince: null,
        commissionRate: 0.08,
      });
    }

    const { data: profile } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isPremium = profile?.status === "active";

    return NextResponse.json({
      isPremium,
      premiumSince: profile?.current_period_start || null,
      commissionRate: isPremium ? 0.05 : 0.08,
    });
  } catch (err) {
    console.error("[Premium Status Error]", err);
    return NextResponse.json({
      isPremium: false,
      premiumSince: null,
      commissionRate: 0.08,
    });
  }
}
