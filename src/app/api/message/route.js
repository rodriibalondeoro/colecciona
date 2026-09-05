import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
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

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    // Validate types explicitly
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body.receiverId || typeof body.receiverId !== "string" || !UUID_RE.test(body.receiverId)) {
      return NextResponse.json({ error: "Destinatario inválido" }, { status: 400 });
    }
    if (!body.text || typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json({ error: "El mensaje no puede estar vacío" }, { status: 400 });
    }
    if (body.text.length > 5000) {
      return NextResponse.json({ error: "Mensaje demasiado largo (máximo 5000 caracteres)" }, { status: 400 });
    }
    if (body.productId !== undefined && body.productId !== null) {
      if (typeof body.productId !== "string" || !UUID_RE.test(body.productId)) {
        return NextResponse.json({ error: "ID de producto inválido" }, { status: 400 });
      }
    }

    // BLOCK self-messaging
    if (body.receiverId === user.id) {
      return NextResponse.json({ error: "No puedes enviarte mensajes a ti mismo" }, { status: 400 });
    }

    const token = extractToken(req);
    if (!token) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Use authenticated client for message insert — enforces RLS
    const userClient = createUserClient(token);
    // Use service role only for notifications (server-side, no RLS needed)
    const serviceClient = createClient(url, key);

    // VALIDATE receiver exists
    const { data: receiver, error: receiverError } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("id", body.receiverId)
      .single();

    if (receiverError || !receiver) {
      return NextResponse.json({ error: "Destinatario no encontrado" }, { status: 404 });
    }

    // VALIDATE product exists (if provided)
    if (body.productId) {
      const { data: product, error: productError } = await serviceClient
        .from("products")
        .select("id")
        .eq("id", body.productId)
        .single();

      if (productError || !product) {
        return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      }
    }

    // Insert message via authenticated client (RLS enforced: auth.uid() = sender_id)
    const { data: message, error } = await userClient
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
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    // Create notification for recipient (server-side via service role)
    // Non-blocking: log error but don't fail the message.
    const { error: notifError } = await serviceClient.from("notifications").insert({
      user_id: body.receiverId,
      type: "message",
      title: "Nuevo mensaje",
      message: body.text.length > 100 ? body.text.substring(0, 100) + "…" : body.text,
      data: { sender_id: user.id },
      link: `/messages`,
    });
    if (notifError) {
      console.error("[API /message] Notification insert failed:", notifError.message);
    }

    return NextResponse.json({ success: true, messageId: message.id, createdAt: message.created_at });
  } catch (err) {
    console.error("[API /message] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
