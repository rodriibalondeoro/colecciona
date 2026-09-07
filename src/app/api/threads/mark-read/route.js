import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body?.partnerId || typeof body.partnerId !== "string" || !UUID_RE.test(body.partnerId)) {
      return NextResponse.json({ error: "partnerId inválido" }, { status: 400 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { error } = await supabase
      .from("messages")
      .update({ read: true })
      .eq("sender_id", body.partnerId)
      .eq("receiver_id", user.id)
      .eq("read", false);

    if (error) {
      console.error("[API /threads/mark-read] Error:", error.message);
      return NextResponse.json({ error: "Error marking as read" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API /threads/mark-read] Error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
