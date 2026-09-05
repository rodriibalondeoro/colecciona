import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

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

    const rl = await rateLimit(`notifications:${user.id}`, { limit: 20, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { id, all } = body;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (all === true) {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
      if (error) {
        console.error("[Notifications] Supabase error:", error.message);
        return NextResponse.json({ error: "Error updating notifications" }, { status: 500 });
      }
    } else if (id && typeof id === "string" && UUID_RE.test(id)) {
      // IDOR FIX: always filter by user_id — users can only mark their own notifications
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", user.id);
      if (error) {
        console.error("[Notifications] Supabase error:", error.message);
        return NextResponse.json({ error: "Error updating notification" }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: "Parámetros inválidos: usa 'all: true' o un 'id' UUID válido" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
