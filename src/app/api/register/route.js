import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(req) {
  try {
    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }
    const supabase = createClient(url, key);
    const body = await req.json();

    const email = (body.email || "").trim();
    const phone = normalizePhone(body.phone);
    const name = String(body.fullName || "").trim();
    const username = String(body.username || "").replace("@", "").trim();

    if (!email) {
      return NextResponse.json({ error: "Email obligatorio" }, { status: 400 });
    }

    // 1 número = 1 cuenta: bloqueamos teléfonos duplicados antes de crear nada.
    // Comparamos por dígitos para tolerar prefijo/espacios.
    if (phone) {
      const digits = phone.replace(/\D/g, "");
      const { data: all } = await supabase
        .from("users")
        .select("email, name, username, phone")
        .not("phone", "eq", "");
      const dup = (all || []).find((u) => u.phone && u.phone.replace(/\D/g, "") === digits);
      if (dup) {
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
      password: body.password || `Colecciona${Date.now()}`,
      email_confirm: true,
      user_metadata: {
        phone,
        full_name: name,
        username,
      },
    });

    if (!error && data?.user?.id) {
      userId = data.user.id;
      // Ajustamos la fila creada por el trigger (lleva email como nombre por defecto)
      const { error: updateError } = await supabase
        .from("users")
        .update({ name, username, phone, member_since: new Date().toISOString(), seller_shipping_methods: ["sm1"] })
        .eq("id", userId);
      if (updateError) console.error("[API /register] update fila:", updateError.message);
    } else {
      // Fallback: usuario puede que ya existiera (login). Intentamos resolverlo.
      const { data: existing } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
      if (existing) {
        userId = existing.id;
      } else if (error) {
        return NextResponse.json({ error: error.message || "No se pudo crear el usuario" }, { status: 500 });
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "No se pudo registrar el usuario" }, { status: 500 });
    }

    const { data: finalUser, error: fetchError } = await supabase.from("users").select("*").eq("id", userId).single();
    if (fetchError) {
      return NextResponse.json({ error: "No se pudo cargar el usuario" }, { status: 500 });
    }

    return NextResponse.json({ success: true, user: finalUser });
  } catch (err) {
    console.error("[API /register] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
