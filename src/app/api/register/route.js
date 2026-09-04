import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`register:${ip}`, { limit: 5, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiados registros. Espera un momento." }, { status: 429 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }
    const supabase = createClient(url, key);
    const body = await req.json();

    const email = (body.email || "").trim().slice(0, 254);
    const phone = normalizePhone(body.phone);
    const name = String(body.fullName || "").trim().slice(0, 100);
    const username = String(body.username || "").replace("@", "").trim().slice(0, 30);
    const password = String(body.password || "");

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Email obligatorio y válido" }, { status: 400 });
    }

    if (password.length < 6 || password.length > 128) {
      return NextResponse.json({ error: "La contraseña debe tener entre 6 y 128 caracteres" }, { status: 400 });
    }

    // 1 número = 1 cuenta: check phone uniqueness via SQL (no download all phones)
    if (phone) {
      const digits = phone.replace(/\D/g, "");
      // Use RPC for efficient phone duplicate check without downloading all phones
      const { data: phoneExists } = await supabase.rpc("check_phone_exists", {
        p_phone_digits: digits,
      });
      if (phoneExists) {
        return NextResponse.json(
          {
            error: `Este número de teléfono ya está asociado a una cuenta activa. Sólo se permite una cuenta por número de teléfono.`,
            code: "PHONE_IN_USE",
          },
          { status: 409 }
        );
      }
    }

    let userId = null;

    // Creamos el usuario en Auth para que exista el id (la fila de public.users
    // se crea automáticamente vía trigger con ese id). Usamos password + email_confirm
    // + user_metadata con phone (si pasamos `phone` suelto, GoTrue inserta '' y
    // choca con el constraint users_phone_key).
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: password || `Colecciona${Date.now()}`,
      email_confirm: true,
      user_metadata: {
        phone,
        full_name: name,
        username,
      },
    });

    if (!error && data?.user?.id) {
      userId = data.user.id;
      // Update profile created by trigger
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ name, username })
        .eq("id", userId);
      if (updateError) console.error("[API /register] update profile:", updateError.message);

      // Update private data created by trigger
      await supabase
        .from("user_private")
        .update({ phone })
        .eq("user_id", userId);
    } else {
      // Fallback: usuario puede que ya existiera
      const { data: existing } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      if (existing) {
        userId = existing.id;
      } else if (error) {
        return NextResponse.json({ error: error.message || "No se pudo crear el usuario" }, { status: 500 });
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "No se pudo registrar el usuario" }, { status: 500 });
    }

    const { data: finalProfile, error: fetchError } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (fetchError) {
      return NextResponse.json({ error: "No se pudo cargar el usuario" }, { status: 500 });
    }

    return NextResponse.json({ success: true, user: finalProfile });
  } catch (err) {
    console.error("[API /register] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
