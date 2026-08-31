import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";

export async function GET(req) {
  const fallback = { isPremium: false, premiumSince: null, commissionRate: 0.08 };
  try {
    const authHeader = req.headers.get("authorization");
    const emailHeader = req.headers.get("x-user-email");

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json(fallback);

    let userId = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data } = await supabase.auth.getUser(token);
      userId = data?.user?.id;
    }

    if (!userId && emailHeader) {
      const { data: users } = await supabase
        .from("users")
        .select("id")
        .eq("email", emailHeader)
        .single();
      userId = users?.id;
    }

    if (!userId) {
      return NextResponse.json({
        isPremium: false,
        premiumSince: null,
        commissionRate: 0.08,
      });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("is_premium, premium_since")
      .eq("id", userId)
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
