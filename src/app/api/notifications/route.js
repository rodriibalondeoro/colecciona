import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ notifications: [] });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ notifications: [] });

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ notifications: data || [] });
}

export async function POST(req) {
  const { user, error: authError } = await verifyAuth(req);
  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { recipientId, type = "general", title, body, link = "#" } = await req.json();
  if (!recipientId || !title) {
    return NextResponse.json({ error: "recipientId y title son obligatorios" }, { status: 400 });
  }

  // SECURITY: users can only create notifications for OTHER users (not self-spam)
  // Server-side notifications (message, offer, etc.) should use serviceRole directly.
  if (recipientId === user.id) {
    return NextResponse.json({ error: "No puedes crear notificaciones para ti mismo" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

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

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

  const { id, all } = await req.json();

  if (all) {
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  } else if (id) {
    // IDOR FIX: always filter by user_id — users can only mark their own notifications
    await supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", user.id);
  }

  return NextResponse.json({ success: true });
}
