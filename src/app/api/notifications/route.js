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

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[Notifications] Supabase error:", error.message);
      return NextResponse.json({ error: "Error loading notifications" }, { status: 500 });
    }

    return NextResponse.json({ notifications: data || [] });
  } catch (err) {
    console.error("[Notifications] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
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
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { id, all } = await req.json();

    if (all) {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
      if (error) {
        console.error("[Notifications] Supabase error:", error.message);
        return NextResponse.json({ error: "Error updating notifications" }, { status: 500 });
      }
    } else if (id) {
      // IDOR FIX: always filter by user_id — users can only mark their own notifications
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", user.id);
      if (error) {
        console.error("[Notifications] Supabase error:", error.message);
        return NextResponse.json({ error: "Error updating notification" }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
