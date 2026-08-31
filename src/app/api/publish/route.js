import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";
import { appendFileSync } from "fs";

function logDebug(msg) {
  try { appendFileSync("/tmp/colecciona-publish.log", `${new Date().toISOString()} ${msg}\n`); } catch {}
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCT_STATUSES = new Set(["DRAFT", "ACTIVE"]);

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

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const body = await req.json();
    const status = PRODUCT_STATUSES.has(body.status) ? body.status : "ACTIVE";
    logDebug(`body: seller=${user.id} title=${body.title} img=${String(body.image).slice(0, 60)}`);
    const supabase = createClient(url, key);

    const { data, error } = await supabase
      .from("products")
      .insert({
        title: body.title,
        price: body.price,
        image: body.image,
        category: body.category,
        condition: body.condition,
        seller: user.id,
        code: body.code,
        rarity: body.rarity,
        description: body.description,
        set: body.set,
        language: body.language,
        year: body.year,
        status,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[API /publish] Error de Supabase:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if any users have this card as MISSING and notify them
    try {
      const cardTitle = body.title || "";
      const { data: missingHolders } = await supabase
        .from("collection_items")
        .select("user_id, card_name")
        .eq("status", "MISSING")
        .ilike("card_name", cardTitle)
        .neq("user_id", user.id);

      if (missingHolders && missingHolders.length > 0) {
        const notifications = missingHolders.map(h => ({
          user_id: h.user_id,
          type: "price_alert",
          title: "🔥 ¡Cromo de tu lista de faltas disponible!",
          message: `"${cardTitle}" acaba de ser publicado por ${user.id} a ${body.price}€.`,
          data: { product_id: data.id, card_name: h.card_name },
          read: false,
          created_at: new Date().toISOString(),
        }));
        await supabase.from("notifications").insert(notifications);
      }
    } catch (notifErr) {
      console.warn("[API /publish] Error sending price alerts:", notifErr);
    }

    return NextResponse.json({ success: true, product: data });
  } catch (err) {
    console.error("[API /publish] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
