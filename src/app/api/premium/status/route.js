import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req) {
  try {
    const authHeader = req.headers.get("authorization");
    const emailHeader = req.headers.get("x-user-email");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(url, serviceKey);

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
