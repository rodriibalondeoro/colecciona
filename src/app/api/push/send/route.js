import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:soporte@colecciona.com";

// Push send is server-side only — clients should NOT control recipientId.
// This endpoint is now only usable by the backend (via service_role in
// notification flows). Direct client access is blocked by auth check
// + the fact that recipientId must come from a trusted backend source.
export async function POST(req) {
  const { user, error: authError } = await verifyAuth(req);
  if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "VAPID no configurado" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  // Validate inputs
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!body.recipientId || typeof body.recipientId !== "string" || !UUID_RE.test(body.recipientId)) {
    return NextResponse.json({ error: "recipientId inválido" }, { status: 400 });
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return NextResponse.json({ error: "title debe ser texto" }, { status: 400 });
  }
  if (body.body !== undefined && typeof body.body !== "string") {
    return NextResponse.json({ error: "body debe ser texto" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, keys_p256dh, keys_auth")
    .eq("user_id", body.recipientId);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title: (body.title || "Colecciona").slice(0, 100),
    body: (body.body || "Tienes una nueva actualización.").slice(0, 500),
    icon: "/images/cards/collection.png",
    badge: "/images/cards/collection.png",
    link: body.link || "/",
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
        payload
      );
      sent++;
    } catch (pushErr) {
      if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  return NextResponse.json({ success: true, sent });
}
