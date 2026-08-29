import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";
import { appendFileSync } from "fs";

function logDebug(msg) {
  try { appendFileSync("/tmp/colecciona-publish.log", `${new Date().toISOString()} ${msg}\n`); } catch {}
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const authHeader = req.headers.get("authorization") || "(none)";
    logDebug(`POST ip=${ip} auth=${authHeader.slice(0, 30)}`);
    const isDev = process.env.NODE_ENV !== "production";
    if (!isDev) {
      const rl = rateLimit(`publish:${ip}`, { limit: 10, windowMs: 60000 });
      if (!rl.allowed) {
        logDebug("RATE LIMITED");
        return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
      }
    }

    if (!url || !key) {
      logDebug("SUPABASE NOT CONFIGURED");
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const body = await req.json();
    logDebug(`body: sellerEmail=${body.sellerEmail} title=${body.title} img=${String(body.image).slice(0, 60)}`);
    const supabase = createClient(url, key);

    let sellerId = null;

    // Intentar auth con JWT
    const { user, error: authError } = await verifyAuth(req);
    if (user) {
      sellerId = user.id;
    } else {
      // Sin JWT: resolver seller por email del body
      const email = body.sellerEmail;
      if (!email) {
        return NextResponse.json({ error: "No autenticado y sin email" }, { status: 401 });
      }
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .limit(1)
        .single();
      if (existingUser) {
        sellerId = existingUser.id;
      } else {
        // Crear el usuario Auth primero (dispara el trigger handle_new_user
        // que crea la fila en public.users con el id correcto).
        const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: body.sellerName || email },
          password: Math.random().toString(36).slice(2) + "Ab1!",
        });
        if (authErr) {
          console.error("[API /publish] Error creando auth user:", authErr);
        }
        if (authUser?.user?.id) {
          sellerId = authUser.user.id;
        } else {
          const { data: fallbackUser } = await supabase
            .from("users")
            .insert({
              id: authUser?.user?.id || undefined,
              email,
              username: email.split("@")[0],
              name: body.sellerName || email,
              member_since: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (fallbackUser) sellerId = fallbackUser.id;
        }
      }
    }

    if (!sellerId) {
      return NextResponse.json({ error: "No se pudo resolver el vendedor" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("products")
      .insert({
        title: body.title,
        price: body.price,
        image: body.image,
        category: body.category,
        condition: body.condition,
        seller: sellerId,
        code: body.code,
        rarity: body.rarity,
        description: body.description,
        set: body.set,
        language: body.language,
        year: body.year,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[API /publish] Error de Supabase:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, product: data });
  } catch (err) {
    console.error("[API /publish] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
