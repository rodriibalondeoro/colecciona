import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const from = (page - 1) * limit;

    // Get last message per thread using a window function (SQL, not JS)
    // This avoids loading ALL messages into memory
    const { data: lastMessages, error: msgError } = await supabase
      .rpc("get_thread_summaries", {
        p_user_id: user.id,
        p_limit: limit,
        p_offset: from,
      });

    if (msgError) {
      console.error("[API /threads] RPC error:", msgError.message);
      return NextResponse.json({ error: "Error loading threads" }, { status: 500 });
    }

    if (!lastMessages || lastMessages.length === 0) {
      return NextResponse.json({ threads: [] });
    }

    // Collect partner and product IDs for batch fetch
    const partnerIds = [...new Set(lastMessages.map(t => t.partner_id).filter(Boolean))];
    const productIds = [...new Set(lastMessages.map(t => t.product_id).filter(Boolean))];

    // Batch fetch profiles
    let profiles = [];
    if (partnerIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, name, username, avatar_url")
        .in("id", partnerIds);
      profiles = data || [];
    }
    const profileMap = new Map(profiles.map(p => [p.id, p]));

    // Batch fetch products
    let products = [];
    if (productIds.length > 0) {
      const { data } = await supabase
        .from("products")
        .select("id, title, image, price")
        .in("id", productIds);
      products = data || [];
    }
    const productMap = new Map(products.map(p => [p.id, p]));

    // Build thread summaries
    const threads = lastMessages.map(t => ({
      id: `th-${t.partner_id}-${t.product_id || "g"}`,
      partnerId: t.partner_id,
      productId: t.product_id,
      lastMessage: t.last_message,
      lastTime: t.last_time,
      unread: t.unread_count || 0,
      partner: profileMap.get(t.partner_id) || { id: t.partner_id, name: "Usuario" },
      product: t.product_id ? productMap.get(t.product_id) || null : null,
    }));

    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[API /threads] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
