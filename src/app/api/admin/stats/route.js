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
  const supabase = createClient(url, serviceKey);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    productsRes,
    usersRes,
    ordersRes,
    messagesRes,
    recentProductsRes,
    recentUsersRes,
    recentOrdersRes,
  ] = await Promise.all([
    supabase.from("products").select("id, category, created_at", { count: "exact" }),
    supabase.from("profiles").select("id, created_at", { count: "exact" }),
    supabase.from("orders").select("id, total, commission, status, created_at", { count: "exact" }),
    supabase.from("messages").select("id", { count: "exact" }),
    supabase.from("products").select("id, title, image, price, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("profiles").select("id, username, avatar_url, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("orders").select("id, total, status, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  const products = productsRes.data || [];
  const users = usersRes.data || [];
  const orders = ordersRes.data || [];
  const messages = messagesRes.data || [];

  const totalProducts = productsRes.count ?? products.length;
  const totalUsers = usersRes.count ?? users.length;
  const totalOrders = ordersRes.count ?? orders.length;
  const totalMessages = messagesRes.count ?? messages.length;

  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const totalCommission = orders.reduce((sum, o) => sum + (Number(o.commission) || 0), 0);

  const byCategory = {};
  products.forEach((p) => {
    const cat = p.category || "other";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });

  const byStatus = {};
  orders.forEach((o) => {
    const st = o.status || "unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
  });

  const recentProducts = (recentProductsRes.data || []).filter((p) => p.created_at >= thirtyDaysAgo).length;
  const recentUsers = (recentUsersRes.data || []).filter((u) => u.created_at >= thirtyDaysAgo).length;
  const recentOrders = (recentOrdersRes.data || []).filter((o) => o.created_at >= thirtyDaysAgo).length;

  return NextResponse.json({
    stats: {
      totalProducts,
      totalUsers,
      totalOrders,
      totalRevenue,
      totalCommission,
      totalMessages,
      recentProducts,
      recentUsers,
      recentOrders,
      byCategory,
      byStatus,
      recentProductsList: recentProductsRes.data || [],
      recentUsersList: recentUsersRes.data || [],
      recentOrdersList: recentOrdersRes.data || [],
    },
  });
}
