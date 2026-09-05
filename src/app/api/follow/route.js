import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

async function resolveUser(req) {
  const { user } = await verifyAuth(req);
  if (user) return user;
  return null;
}

export async function POST(req) {
  try {
    const user = await resolveUser(req);
    if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json();
    const { targetUserId } = body;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!targetUserId || typeof targetUserId !== "string" || !UUID_RE.test(targetUserId)) {
      return NextResponse.json({ error: "ID de usuario inválido" }, { status: 400 });
    }
    if (targetUserId === user.id) return NextResponse.json({ error: "No puedes seguirte" }, { status: 400 });

    // Atomic: insert follow + increment both counters in one transaction
    const supabase = createUserClient(token);
    const { data, error: rpcError } = await supabase.rpc("follow_user", {
      p_target_user_id: targetUserId,
    });

    if (rpcError) {
      if (rpcError.message?.includes("User not found")) {
        return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
      }
      if (rpcError.message?.includes("Cannot follow yourself")) {
        return NextResponse.json({ error: "No puedes seguirte" }, { status: 400 });
      }
      console.error("[Follow] RPC error:", rpcError.message);
      return NextResponse.json({ error: "No se pudo seguir al usuario" }, { status: 500 });
    }

    // Notification (best-effort, non-blocking)
    const serviceClient = (await import("@supabase/supabase-js")).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { error: notifError } = await serviceClient.from("notifications").insert({
      user_id: targetUserId,
      type: "follow",
      title: "Nuevo seguidor",
      message: "Alguien empezó a seguirte",
      data: { link: `/seller/${user.id}` },
    });
    if (notifError) console.warn("[Follow] Notification error:", notifError.message);

    return NextResponse.json({ success: true, following: true });
  } catch (err) {
    console.error("Error following:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const user = await resolveUser(req);
    if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("targetUserId");
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!targetUserId || typeof targetUserId !== "string" || !UUID_RE.test(targetUserId)) {
      return NextResponse.json({ error: "ID de usuario inválido" }, { status: 400 });
    }

    // Atomic: delete follow + decrement both counters in one transaction
    const supabase = createUserClient(token);
    const { data, error: rpcError } = await supabase.rpc("unfollow_user", {
      p_target_user_id: targetUserId,
    });

    if (rpcError) {
      console.error("[Unfollow] RPC error:", rpcError.message);
      return NextResponse.json({ error: "No se pudo dejar de seguir" }, { status: 500 });
    }

    return NextResponse.json({ success: true, following: false });
  } catch (err) {
    console.error("Error unfollowing:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const user = await resolveUser(req);
    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("targetUserId");

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!targetUserId || typeof targetUserId !== "string" || !UUID_RE.test(targetUserId)) {
      return NextResponse.json({ following: false });
    }

    if (!user) return NextResponse.json({ following: false });

    const token = extractToken(req);
    if (!token) return NextResponse.json({ following: false });

    const supabase = createUserClient(token);
    const { data } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId)
      .single();

    return NextResponse.json({ following: !!data });
  } catch {
    return NextResponse.json({ following: false });
  }
}
