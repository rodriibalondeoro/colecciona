import { NextResponse } from "next/server";
import { verifyAuth, createUserClient } from "@/lib/serverAuth";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  try {
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = req.headers.get("authorization")?.slice(7);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const userClient = createUserClient(token);
    const { data: profile } = await userClient
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const serviceClient = createClient(url, serviceKey);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const { data: disputedOrders, error } = await serviceClient
      .from("orders")
      .select(`
        id, status, subtotal, shipping, total, commission,
        created_at, completed_at,
        buyer:buyer_id (id, name, username),
        seller:seller_id (id, name, username)
      `)
      .eq("status", "DISPUTED")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[API /admin/disputes] Error:", error.message);
      return NextResponse.json({ error: "Error loading disputes" }, { status: 500 });
    }

    const { data: disputedTrades } = await serviceClient
      .from("trade_proposals")
      .select(`
        id, status, created_at,
        proposer:proposer_id (id, name, username),
        receiver:receiver_id (id, name, username),
        products:proposed_product_ids
      `)
      .eq("status", "DISPUTED")
      .order("created_at", { ascending: false })
      .limit(limit);

    return NextResponse.json({
      orders: disputedOrders || [],
      trades: disputedTrades || [],
    });
  } catch (err) {
    console.error("[API /admin/disputes] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
