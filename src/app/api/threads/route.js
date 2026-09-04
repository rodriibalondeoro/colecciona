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

    // Get all messages for this user
    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, product_id, text, created_at")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("[API /threads] Supabase error:", msgError.message);
      return NextResponse.json({ error: "Error loading threads" }, { status: 500 });
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ threads: [] });
    }

    // Derive threads from messages
    const threadMap = new Map();
    for (const msg of messages) {
      const partnerId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
      const key = `${partnerId}:${msg.product_id || "null"}`;

      if (!threadMap.has(key)) {
        threadMap.set(key, {
          id: `th-${partnerId}-${msg.product_id || "g"}`,
          partnerId,
          productId: msg.product_id,
          messages: [],
          lastMessage: "",
          lastTime: "",
          unread: 0,
        });
      }

      const thread = threadMap.get(key);
      thread.messages.push({
        id: msg.id,
        from: msg.sender_id === user.id ? "me" : msg.sender_id,
        text: msg.text,
        time: msg.created_at,
      });
      thread.lastMessage = msg.text;
      thread.lastTime = msg.created_at;
      if (msg.receiver_id === user.id && msg.sender_id !== user.id) {
        thread.unread++;
      }
    }

    // Fetch partner profiles
    const partnerIds = [...new Set([...threadMap.values()].map((t) => t.partnerId))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, username, avatar_url")
      .in("id", partnerIds);

    const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

    // Fetch product info
    const productIds = [...new Set([...threadMap.values()].map((t) => t.productId).filter(Boolean))];
    let productMap = new Map();
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, title, image, price")
        .in("id", productIds);
      productMap = new Map((prods || []).map((p) => [p.id, p]));
    }

    // Build final threads
    const threads = [...threadMap.values()]
      .map((t) => ({
        ...t,
        partner: profileMap.get(t.partnerId) || { id: t.partnerId, name: "Usuario" },
        product: t.productId ? productMap.get(t.productId) || null : null,
      }))
      .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));

    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[API /threads] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
