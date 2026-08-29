import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ notifications: [] });

  const supabase = createClient(url, serviceKey);
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ notifications: data || [] });
}

export async function POST(req) {
  const { recipientId, type = "general", title, body, link = "#" } = await req.json();
  if (!recipientId || !title) {
    return NextResponse.json({ error: "recipientId y title son obligatorios" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase
    .from("notifications")
    .insert([{ user_id: recipientId, type, title, body, link, read: false }])
    .select()
    .single();

  if (error) {
    console.warn("[Notifications API] Error al insertar:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, notification: data });
}

export async function PATCH(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No auth" }, { status: 401 });

  const { id, all } = await req.json();
  const supabase = createClient(url, serviceKey);

  if (all) {
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  } else if (id) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  return NextResponse.json({ success: true });
}
