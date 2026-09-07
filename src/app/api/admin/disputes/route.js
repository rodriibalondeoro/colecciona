import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  try {
    if (!url || !key) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const token = authHeader.split(" ")[1];
    const userClient = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const serviceClient = createClient(url, key);

    const { data: profile } = await serviceClient
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { data: disputedOrders, error } = await serviceClient
      .from("orders")
      .select(`
        id, status, subtotal, shipping, total_paid, commission,
        created_at, completed_at,
        buyer:buyer_id (id, name, username),
        seller:seller_id (id, name, username),
        products!orders_product_id_fkey (id, title, image, price)
      `)
      .eq("status", "DISPUTED")
      .order("created_at", { ascending: false });

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
      .order("created_at", { ascending: false });

    return NextResponse.json({
      orders: disputedOrders || [],
      trades: disputedTrades || [],
    });
  } catch (err) {
    console.error("[API /admin/disputes] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
