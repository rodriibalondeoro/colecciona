import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/serverAuth";
import { createClient } from "@supabase/supabase-js";

export async function GET(req) {
  const { user, error } = await verifyAuth(req);
  if (error || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.is_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    productCount,
    userCount,
    orderCount,
    messageCount,
    recentProductsRes,
    recentUsersRes,
    recentOrdersRes,
    categoryStats,
    statusStats,
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id, title, image, price, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("profiles").select("id, username, avatar_url, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("orders").select("id, total, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.rpc("get_category_stats"),
    supabase.rpc("get_order_status_stats"),
  ]);

  const recentProducts = (recentProductsRes.data || []).filter((p) => p.created_at >= thirtyDaysAgo).length;
  const recentUsers = (recentUsersRes.data || []).filter((u) => u.created_at >= thirtyDaysAgo).length;
  const recentOrders = (recentOrdersRes.data || []).filter((o) => o.created_at >= thirtyDaysAgo).length;

  const revenueData = await supabase.rpc("get_revenue_stats");

  return NextResponse.json({
    stats: {
      totalProducts: productCount.count ?? 0,
      totalUsers: userCount.count ?? 0,
      totalOrders: orderCount.count ?? 0,
      totalRevenue: Number(revenueData.data?.total_revenue) || 0,
      totalCommission: Number(revenueData.data?.total_commission) || 0,
      totalMessages: messageCount.count ?? 0,
      recentProducts,
      recentUsers,
      recentOrders,
      byCategory: categoryStats.data || {},
      byStatus: statusStats.data || {},
      recentProductsList: recentProductsRes.data || [],
      recentUsersList: recentUsersRes.data || [],
      recentOrdersList: recentOrdersRes.data || [],
    },
  });
}
