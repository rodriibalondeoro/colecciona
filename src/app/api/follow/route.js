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
    if (!targetUserId) return NextResponse.json({ error: "Falta targetUserId" }, { status: 400 });
    if (targetUserId === user.id) return NextResponse.json({ error: "No puedes seguirte" }, { status: 400 });

    // RLS enforced: auth.uid() = follower_id
    const supabase = createUserClient(token);

    // Validate target user exists
    const { data: targetProfile, error: targetError } = await supabase
      .from("profiles").select("id").eq("id", targetUserId).single();

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId)
      .single();

    if (existing) {
      return NextResponse.json({ success: true, following: true });
    }

    const { error: insertError } = await supabase
      .from("follows")
      .insert({ follower_id: user.id, following_id: targetUserId });

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ success: true, following: true });
      }
      // Hide internal error details
      return NextResponse.json({ error: "No se pudo seguir al usuario" }, { status: 500 });
    }

    // Atomic counter updates — avoid read-modify-write race condition
    try {
      await supabase.rpc("increment_field", { p_table: "profiles", p_field: "followers", p_id: targetUserId });
      await supabase.rpc("increment_field", { p_table: "profiles", p_field: "following", p_id: user.id });
    } catch (countErr) {
      console.error("[Follow] Error actualizando contadores:", countErr);
    }

    // Notification (best-effort)
    try {
      await supabase.from("notifications").insert({
        user_id: targetUserId,
        type: "follow",
        title: "Nuevo seguidor",
        message: "Alguien empezó a seguirte",
        link: `/seller/${user.id}`,
      });
    } catch {}

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
    if (!targetUserId) return NextResponse.json({ error: "Falta targetUserId" }, { status: 400 });

    // RLS enforced: auth.uid() = follower_id
    const supabase = createUserClient(token);

    const { data: existing } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId)
      .single();

    if (!existing) {
      return NextResponse.json({ success: true, following: false });
    }

    await supabase.from("follows").delete().eq("id", existing.id);

    // Atomic counter updates
    try {
      await supabase.rpc("decrement_field", { p_table: "profiles", p_field: "followers", p_id: targetUserId });
      await supabase.rpc("decrement_field", { p_table: "profiles", p_field: "following", p_id: user.id });
    } catch (countErr) {
      console.error("[Follow] Error actualizando contadores:", countErr);
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
