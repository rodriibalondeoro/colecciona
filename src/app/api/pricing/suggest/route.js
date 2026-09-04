import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/rateLimit";

const ALLOWED_CONDITIONS = new Set(["PSA10", "NM", "LP", "MP", "HP", "DMG"]);
const ALLOWED_CATEGORIES = new Set([
  "liga-este-26-27", "liga-oeste-26-27", "copa-26-27", "champions-26-27",
  "nacional", "retro", "especial", "otro",
]);

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`pricing:${ip}`, { limit: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const { category, condition } = await req.json();

    // Validate inputs
    if (category && typeof category === "string" && !ALLOWED_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "Categoría no válida" }, { status: 400 });
    }
    if (condition && typeof condition === "string" && !ALLOWED_CONDITIONS.has(condition)) {
      return NextResponse.json({ error: "Condición no válida" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(url, serviceKey);

    // Buscar productos similares en la misma categoría y condición
    let query = supabase
      .from("products")
      .select("price, condition, category, title")
      .eq("category", category || "liga-este-26-27");

    if (condition) {
      query = query.eq("condition", condition);
    }

    const { data: similarProducts, error } = await query.limit(50);

    if (error || !similarProducts || similarProducts.length === 0) {
      // Sin datos suficientes, devolver estimación genérica
      return NextResponse.json({
        suggestedPrice: null,
        confidence: 0,
        dataSource: "none",
        message: "No hay suficientes productos similares para sugerir precio",
        stats: null,
      });
    }

    // Calcular estadísticas
    const prices = similarProducts.map((p) => parseFloat(p.price)).filter((p) => p > 0);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    // Multiplicador por condición
    const conditionMultipliers = {
      PSA10: 1.6,
      NM: 1.0,
      LP: 0.85,
      MP: 0.7,
      HP: 0.5,
      DMG: 0.35,
    };

    const multiplier = conditionMultipliers[condition] || 1.0;
    const suggestedPrice = parseFloat((median * multiplier).toFixed(2));

    // Confianza basada en cantidad de datos
    const confidence = Math.min(100, Math.round(prices.length * 2.5));

    return NextResponse.json({
      suggestedPrice,
      confidence,
      dataSource: "market",
      stats: {
        avg: parseFloat(avg.toFixed(2)),
        median: parseFloat(median.toFixed(2)),
        min: parseFloat(min.toFixed(2)),
        max: parseFloat(max.toFixed(2)),
        sampleSize: prices.length,
      },
    });
  } catch (err) {
    console.error("[Pricing Suggest Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
