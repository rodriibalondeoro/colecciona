import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const partnerId = searchParams.get("partnerId");
    const productId = searchParams.get("productId");

    if (!partnerId || !UUID_RE.test(partnerId)) {
      return NextResponse.json({ error: "partnerId inválido" }, { status: 400 });
    }
    if (productId && !UUID_RE.test(productId)) {
      return NextResponse.json({ error: "productId inválido" }, { status: 400 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { data, error } = await supabase.rpc("get_thread_messages", {
      p_partner_id: partnerId,
      p_product_id: productId || null,
      p_limit: 500,
      p_offset: 0,
    });

    if (error) {
      console.error("[API /threads/messages] RPC error:", error.message);
      return NextResponse.json({ error: "Error loading messages" }, { status: 500 });
    }

    return NextResponse.json({ messages: data || [] });
  } catch (err) {
    console.error("[API /threads/messages] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
