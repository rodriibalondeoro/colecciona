import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCT_STATUSES = new Set(["DRAFT", "ACTIVE"]);

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const VALID_CATEGORIES = new Set([
  " Pokemon", "Yu-Gi-Oh!", "Magic", "One Piece", "Dragon Ball",
  "Digimon", "Force of Valor", "Lorcana", "Other",
]);
const VALID_CONDITIONS = new Set(["NEW", "LIKE_NEW", "GOOD", "ACCEPTABLE", "POOR"]);

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`publish:${ip}`, { limit: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const body = await req.json();

    // SERVER-SIDE VALIDATION
    if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
      return NextResponse.json({ error: "Título es obligatorio" }, { status: 400 });
    }
    if (body.title.length > TITLE_MAX) {
      return NextResponse.json({ error: `Título máximo ${TITLE_MAX} caracteres` }, { status: 400 });
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Precio debe ser un número positivo" }, { status: 400 });
    }
    if (price > 999999) {
      return NextResponse.json({ error: "Precio máximo 999999" }, { status: 400 });
    }

    if (body.description && body.description.length > DESC_MAX) {
      return NextResponse.json({ error: `Descripción máxima ${DESC_MAX} caracteres` }, { status: 400 });
    }

    if (body.image && typeof body.image === "string" && !body.image.startsWith("http")) {
      return NextResponse.json({ error: "Imagen debe ser una URL válida" }, { status: 400 });
    }

    if (body.year) {
      const year = Number(body.year);
      if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) {
        return NextResponse.json({ error: "Año inválido" }, { status: 400 });
      }
    }

    const status = PRODUCT_STATUSES.has(body.status) ? body.status : "ACTIVE";
    const supabase = createClient(url, key);

    const { data, error } = await supabase
      .from("products")
      .insert({
        title: body.title.trim(),
        price,
        image: body.image || null,
        category: body.category || null,
        condition: body.condition || null,
        seller: user.id,
        code: body.code || null,
        rarity: body.rarity || null,
        description: body.description || null,
        set: body.set || null,
        language: body.language || null,
        year: body.year || null,
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
          title: "Cromo de tu lista de faltas disponible",
          message: `"${cardTitle}" acaba de ser publicado a ${price}€.`,
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
