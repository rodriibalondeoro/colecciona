import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyOtp } from "@/lib/otpStore";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function migrateMockUser(supabase, oldUser, tempPassword) {
  const oldId = oldUser.id;
  const authEmail = oldUser.email || `user_${oldUser.phone?.replace(/\D/g, "") || Date.now()}@colecciona.app`;
  const suffix = `_old_${Date.now()}`;

  // 1. Liberar constraints únicos en la fila vieja
  await supabase.from("profiles").update({ username: `${oldUser.username || "user"}${suffix}` }).eq("id", oldId);
  await supabase.from("user_private").update({ email: `${authEmail}${suffix}` }).eq("user_id", oldId);

  // 2. Crear en Supabase Auth (el trigger crea la fila users nueva)
  const { data: authUser, error: createErr } = await supabase.auth.admin.createUser({
    email: authEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { phone: oldUser.phone, full_name: oldUser.name, username: oldUser.username },
  });
  if (createErr || !authUser?.user?.id) return { error: createErr?.message || "No se pudo crear cuenta" };
  const newId = authUser.user.id;

  // 3. Migrar referencias (ANTES de borrar la fila vieja)
  await supabase.from("products").update({ seller: newId }).eq("seller", oldId);
  await supabase.from("reviews").update({ reviewer_id: newId }).eq("reviewer_id", oldId);
  await supabase.from("reviews").update({ target_user_id: newId }).eq("target_user_id", oldId);
  await supabase.from("orders").update({ seller_id: newId }).eq("seller_id", oldId);
  await supabase.from("orders").update({ buyer_id: newId }).eq("buyer_id", oldId);
  await supabase.from("follows").update({ follower_id: newId }).eq("follower_id", oldId);
  await supabase.from("follows").update({ following_id: newId }).eq("following_id", oldId);
  await supabase.from("offers").update({ from_user_id: newId }).eq("from_user_id", oldId);
  await supabase.from("offers").update({ to_user_id: newId }).eq("to_user_id", oldId);
  await supabase.from("messages").update({ sender_id: newId }).eq("sender_id", oldId);
  await supabase.from("messages").update({ receiver_id: newId }).eq("receiver_id", oldId);
  await supabase.from("push_subscriptions").update({ user_id: newId }).eq("user_id", oldId);

  // 4. Copiar datos a la fila nueva (el trigger creó una fila con defaults)
  await supabase.from("profiles").update({
    name: oldUser.name,
    avatar: oldUser.avatar,
    bio: oldUser.bio,
    sales: oldUser.sales || 0,
    purchases: oldUser.purchases || 0,
    followers: oldUser.followers || 0,
    following: oldUser.following || 0,
    rating: oldUser.rating || 5.0,
    location: oldUser.location,
    response_time: oldUser.response_time || "< 1 hora",
    member_since: oldUser.member_since || String(new Date().getFullYear()),
  }).eq("id", newId);

  await supabase.from("user_private").update({
    phone: oldUser.phone,
  }).eq("user_id", newId);

  await supabase.from("wallet").update({
    balance: oldUser.balance || 0,
  }).eq("user_id", newId);

  // 5. Borrar la fila vieja (ya no tiene FKs apuntando a ella)
  await supabase.from("profiles").delete().eq("id", oldId);
  await supabase.from("user_private").delete().eq("user_id", oldId);
  await supabase.from("wallet").delete().eq("user_id", oldId);

  return { newId, email: authEmail };
}

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = await rateLimit(`sms-verify:${ip}`, { limit: 5, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiados intentos. Espera un momento." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const { otpKey, code } = body;

    if (!otpKey || !code) {
      return NextResponse.json({ error: "Teléfono y código son obligatorios" }, { status: 400 });
    }

    const rawKey = String(otpKey);
    const isEmail = rawKey.includes("@");
    const normalizedKey = isEmail ? rawKey : normalizePhone(rawKey);
    const rawCode = String(code).trim();

    // Atomic verify: one-time use + attempt limit + expiry (Supabase-backed)
    const verifyResult = await verifyOtp(normalizedKey, rawCode, 5);

    if (verifyResult === "expired") {
      return NextResponse.json(
        { error: "Código expirado. Solicita un nuevo código." },
        { status: 400 }
      );
    }
    if (verifyResult === "locked") {
      return NextResponse.json(
        { error: "Demasiados intentos. Solicita un nuevo código." },
        { status: 429 }
      );
    }
    if (verifyResult === "invalid") {
      return NextResponse.json({ error: "Código incorrecto. Revisa el SMS y vuelve a intentarlo." }, { status: 400 });
    }

    let user = null;
    let userPhone = normalizedKey;
    let tempPassword = null;
    if (url && key) {
      const supabase = createClient(url, key);
      if (isEmail) {
        const { data: priv } = await supabase.from("user_private").select("user_id").eq("email", rawKey).maybeSingle();
        if (priv?.user_id) {
          const { data: prof } = await supabase.from("profiles").select("*").eq("id", priv.user_id).single();
          user = prof ? { ...prof, email: rawKey } : null;
        }
        userPhone = user?.phone || userPhone;
      } else {
        const digits = normalizePhone(rawKey).replace(/\D/g, "");
        let { data: priv } = await supabase.from("user_private").select("user_id, phone").eq("phone", normalizedKey).maybeSingle();
        if (!priv && digits.length >= 9) {
          const { data: allPriv } = await supabase.from("user_private").select("user_id, phone").not("phone", "eq", "");
          priv = (allPriv || []).find((u) => u.phone && u.phone.replace(/\D/g, "") === digits) || null;
        }
        if (priv?.user_id) {
          const { data: prof } = await supabase.from("profiles").select("*").eq("id", priv.user_id).single();
          user = prof ? { ...prof, phone: priv.phone } : null;
        }
        userPhone = user?.phone || userPhone;
      }

      if (user?.id) {
        tempPassword = `Col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const isUuid = UUID_RE.test(user.id);

        if (isUuid) {
          // Usuario ya tiene UUID real — solo actualizar password
          const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password: tempPassword });
          if (updateErr) {
            // Auth user no existe — migrar igual
            const result = await migrateMockUser(supabase, user, tempPassword);
            if (result.newId) { user.id = result.newId; user.email = result.email; }
          }
        } else {
          // ID mock — migrar completo
          const result = await migrateMockUser(supabase, user, tempPassword);
          if (result.newId) { user.id = result.newId; user.email = result.email; }
          else if (result.error) console.error("[SMS Verify] Migration error:", result.error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Teléfono verificado correctamente",
      user,
      phone: userPhone,
    });
  } catch (error) {
    console.error("Error en SMS Verify API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
