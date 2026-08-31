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
      .from("users")
      .select("is_premium, premium_since")
      .eq("id", user.id)
      .single();

    const isPremium = profile?.is_premium || false;

    return NextResponse.json({
      isPremium,
      premiumSince: profile?.premium_since || null,
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
