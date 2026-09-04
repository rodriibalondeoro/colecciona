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

// POST REMOVED: notifications are created server-side only via service_role.
// Client-side notification creation was a spam/abuse vector.
// All notification creation happens in API routes (message, offers, etc.)
// using serviceClient directly — no endpoint exposed to the frontend.
export async function POST() {
  return NextResponse.json(
    { error: "Notifications cannot be created via client API" },
    { status: 405 }
  );
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
