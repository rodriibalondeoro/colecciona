import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:soporte@colecciona.com";

export async function POST(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No auth" }, { status: 401 });

  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "VAPID no configurado" }, { status: 500 });
  }

  const { recipientId, title, body, link = "/" } = await req.json();
  if (!recipientId) {
    return NextResponse.json({ error: "recipientId es obligatorio" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, keys_p256dh, keys_auth")
    .eq("user_id", recipientId);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title: title || "Colecciona",
    body: body || "Tienes una nueva actualización.",
    icon: "/images/cards/collection.png",
    badge: "/images/cards/collection.png",
    link,
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