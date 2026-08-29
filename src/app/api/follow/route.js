import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUser(req) {
  const { user } = await verifyAuth(req);
  if (user) return user;

  const userId = req.headers.get("x-user-id");
  if (userId && UUID_RE.test(userId)) {
    const supabase = createClient(url, key);
    const { data } = await supabase.from("users").select("id, username").eq("id", userId).single();
    if (data) return { id: data.id, username: data.username };
  }

  const email = req.headers.get("x-user-email");
  if (!email) return null;

  const supabase = createClient(url, key);
  const { data } = await supabase.from("users").select("id, username").eq("email", email).single();
  return data ? { id: data.id, username: data.username } : null;
}

export async function POST(req) {
  try {
    const user = await resolveUser(req);
    if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json();
    const { targetUserId } = body;
    if (!targetUserId) return NextResponse.json({ error: "Falta targetUserId" }, { status: 400 });
    if (targetUserId === user.id) return NextResponse.json({ error: "No puedes seguirte" }, { status: 400 });

    const supabase = createClient(url, key);

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
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Actualizar contadores (best-effort, no deben fallar la operación)
    try {
      const { data: targetUser } = await supabase.from("users").select("followers").eq("id", targetUserId).single();
      if (targetUser) {
        await supabase.from("users").update({ followers: (targetUser.followers || 0) + 1 }).eq("id", targetUserId);
      }
      const { data: currentUser } = await supabase.from("users").select("following").eq("id", user.id).single();
      if (currentUser) {
        await supabase.from("users").update({ following: (currentUser.following || 0) + 1 }).eq("id", user.id);
      }
      await supabase.from("notifications").insert({
        user_id: targetUserId,
        type: "follow",
        title: "Nuevo seguidor",
        body: `Alguien empezó a seguirte`,
        link: "/seller/",
      }).catch(() => {});
    } catch (countErr) {
      console.error("[Follow] Error actualizando contadores:", countErr);
    }

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

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("targetUserId");
    if (!targetUserId) return NextResponse.json({ error: "Falta targetUserId" }, { status: 400 });

    const supabase = createClient(url, key);

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

    const { data: targetUser } = await supabase.from("users").select("followers").eq("id", targetUserId).single();
    if (targetUser && (targetUser.followers || 0) > 0) {
      await supabase.from("users").update({ followers: targetUser.followers - 1 }).eq("id", targetUserId);
    }
    const { data: currentUser } = await supabase.from("users").select("following").eq("id", user.id).single();
    if (currentUser && (currentUser.following || 0) > 0) {
      await supabase.from("users").update({ following: currentUser.following - 1 }).eq("id", user.id);
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

    const supabase = createClient(url, key);
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
