import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No auth" }, { status: 401 });

  const { subscription } = await req.json();
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error: insertError } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        keys_p256dh: subscription.keys?.p256dh || "",
        keys_auth: subscription.keys?.auth || "",
      },
      { onConflict: "endpoint" }
    )
    .select()
    .single();

  if (insertError) {
    console.warn("[Push API] Error guardando suscripción:", insertError.message);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, subscription: data });
}

export async function DELETE(req) {
  const { user, error: authError } = await verifyAuth(req);
  if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { endpoint } = await req.json().catch(() => ({}));
  const supabase = createClient(url, serviceKey);
  if (endpoint) {
    // Always filter by user_id to prevent deleting other users' subscriptions
    await supabase.from("push_subscriptions").delete()
      .eq("endpoint", endpoint)
      .eq("user_id", user.id);
  } else {
    await supabase.from("push_subscriptions").delete().eq("user_id", user.id);
  }
  return NextResponse.json({ success: true });
}