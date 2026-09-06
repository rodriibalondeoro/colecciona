import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mapRpcError(message) {
  if (!message) return { status: 500 };
  const codeMatch = message.match(/^\[([A-Z_]+)\]/);
  const code = codeMatch ? codeMatch[1] : null;
  switch (code) {
    case "PRODUCT_NOT_FOUND": return { status: 404 };
    case "OFFER_NOT_FOUND": return { status: 404 };
    case "AUTH_REQUIRED": return { status: 401 };
    case "NOT_SELLER": return { status: 403 };
    case "NOT_BUYER": return { status: 403 };
    case "SELF_OFFER": return { status: 409 };
    case "PRODUCT_UNAVAILABLE": return { status: 409 };
    case "OFFER_NOT_PENDING": return { status: 409 };
    case "INVALID_AMOUNT": return { status: 400 };
    case "MESSAGE_TOO_LONG": return { status: 400 };
    default: return { status: 500 };
  }
}

export async function GET(req) {
  const { user, error: authError } = await verifyAuth(req);
  if (authError || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const supabase = createUserClient(token);
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "all";

  const allowedTypes = ["all", "received", "sent"];
  if (!allowedTypes.includes(type)) {
    return NextResponse.json({ error: "type no válido" }, { status: 400 });
  }

  let dbQuery = supabase
    .from("offers")
    .select(`
      *,
      product:products!offers_product_id_fkey(id, title, image, price, status, seller),
      from_user:profiles!offers_from_user_id_fkey(id, username, name, avatar, rating, sales),
      to_user:profiles!offers_to_user_id_fkey(id, username, name, avatar, rating, sales)
    `);

  if (type === "received") {
    dbQuery = dbQuery.eq("to_user_id", user.id);
  } else if (type === "sent") {
    dbQuery = dbQuery.eq("from_user_id", user.id);
  } else {
    dbQuery = dbQuery.or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`);
  }

  const { data, error: dbError } = await dbQuery.order("created_at", { ascending: false }).limit(100);

  if (dbError) {
    console.error("[Offers API] GET error:", dbError.message);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const offers = (data || []).map((o) => ({
    ...o,
    direction: o.from_user_id === user.id ? "sent" : "received",
  }));

  return NextResponse.json({ offers });
}

export async function POST(req) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const rl = await rateLimit(`offers:${ip}`, { limit: 10, windowMs: 60000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
  }

  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const { productId, amount, message } = body;

  if (!productId || !amount) {
    return NextResponse.json({ error: "productId y amount son obligatorios" }, { status: 400 });
  }

  // Validate productId is UUID
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof productId !== "string" || !UUID_RE.test(productId)) {
    return NextResponse.json({ error: "productId inválido" }, { status: 400 });
  }

  // Validate amount is a number (not string)
  if (typeof amount === "string" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Importe inválido" }, { status: 400 });
  }
  if (amount > 999999.99) {
    return NextResponse.json({ error: "Importe demasiado alto" }, { status: 400 });
  }
  const decimalPart = amount.toString().split(".")[1];
  if (decimalPart && decimalPart.length > 2) {
    return NextResponse.json({ error: "Importe máximo 2 decimales" }, { status: 400 });
  }

  // Validate message length (max 1000 chars)
  if (message !== undefined && message !== null) {
    if (typeof message !== "string") {
      return NextResponse.json({ error: "message debe ser texto" }, { status: 400 });
    }
    if (message.length > 1000) {
      return NextResponse.json({ error: "Mensaje demasiado largo (máximo 1000 caracteres)" }, { status: 400 });
    }
  }

  const supabase = createUserClient(token);

  const { data, error: rpcError } = await supabase.rpc("create_offer", {
    p_product_id: productId,
    p_amount: amount,
    p_message: message || "",
  });

    if (rpcError) {
    console.error("[Offers API] create_offer error:", rpcError.message);
    const mapped = mapRpcError(rpcError.message);
    if (mapped.status === 500) {
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    return NextResponse.json({ error: "Error al crear la oferta" }, { status: mapped.status });
  }

  return NextResponse.json({ success: true, offer: data });
}
