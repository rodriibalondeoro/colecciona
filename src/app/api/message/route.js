import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`message:${ip}`, { limit: 30, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }
    const supabase = createClient(url, key);
    const body = await req.json();

    if (!body.receiverId || !body.text) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    // Insert message
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        sender_id: user.id,
        receiver_id: body.receiverId,
        product_id: body.productId || null,
        text: body.text,
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("[API /message] Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Create notification for recipient (server-side, reliable)
    await supabase.from("notifications").insert({
      user_id: body.receiverId,
      type: "message",
      title: "Nuevo mensaje",
      body: body.text.length > 100 ? body.text.substring(0, 100) + "…" : body.text,
      link: `/messages`,
    });

    return NextResponse.json({ success: true, messageId: message.id, createdAt: message.created_at });
  } catch (err) {
    console.error("[API /message] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
