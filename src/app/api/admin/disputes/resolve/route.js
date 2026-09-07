import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
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

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const { orderId, type } = body;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!orderId || !UUID_RE.test(orderId)) {
      return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
    }
    if (type !== "refund" && type !== "complete") {
      return NextResponse.json({ error: "type must be 'refund' or 'complete'" }, { status: 400 });
    }

    if (type === "refund") {
      const { data, error } = await serviceClient.rpc("begin_refund", {
        p_order_id: orderId,
      });
      if (error) {
        console.error("[API /admin/disputes/resolve] begin_refund error:", error.message);
        return NextResponse.json({ error: error.message || "Error initiating refund" }, { status: 500 });
      }
      return NextResponse.json({ success: true, result: data });
    }

    // type === "complete" — resolve dispute in favor of completing (seller wins)
    const { error } = await serviceClient
      .from("orders")
      .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "DISPUTED");

    if (error) {
      console.error("[API /admin/disputes/resolve] complete error:", error.message);
      return NextResponse.json({ error: error.message || "Error completing order" }, { status: 500 });
    }

    return NextResponse.json({ success: true, result: { order_id: orderId, status: "COMPLETED" } });
  } catch (err) {
    console.error("[API /admin/disputes/resolve] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
