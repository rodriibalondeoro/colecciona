import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRpcError(message) {
  if (!message) return { status: 500 };
  if (message.includes("Authentication required")) return { status: 401 };
  if (message.includes("Order not found")) return { status: 404 };
  if (message.includes("Can only review")) return { status: 400 };
  if (message.includes("not a participant")) return { status: 403 };
  if (message.includes("already reviewed")) return { status: 400 };
  if (message.includes("deleted")) return { status: 403 };
  return { status: 500 };
}

export async function POST(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const rl = await rateLimit(`reviews:${user.id}`, { limit: 5, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    // Validate input types
    if (!body.orderId || typeof body.orderId !== "string" || !UUID_RE.test(body.orderId)) {
      return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
    }
    if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
      return NextResponse.json({ error: "Valoración debe ser un entero entre 1 y 5" }, { status: 400 });
    }
    if (body.comment !== undefined && body.comment !== null) {
      if (typeof body.comment !== "string") {
        return NextResponse.json({ error: "Comentario inválido" }, { status: 400 });
      }
      if (body.comment.length > 2000) {
        return NextResponse.json({ error: "Comentario demasiado largo (máximo 2000 caracteres)" }, { status: 400 });
      }
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);
    const { data, error: rpcError } = await supabase.rpc("create_review", {
      p_order_id: body.orderId,
      p_rating: body.rating,
      p_comment: body.comment || null,
    });

    if (rpcError) {
      const mapped = mapRpcError(rpcError.message);
      return NextResponse.json(
        { error: "Error al crear la reseña" },
        { status: mapped.status }
      );
    }

    return NextResponse.json({ success: true, review: data });
  } catch (err) {
    console.error("[Reviews POST]", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) return NextResponse.json({ reviews: [] });

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data } = await supabase
      .from("reviews")
      .select(
        "*, reviewer:profiles!reviews_reviewer_id_fkey(name, username)"
      )
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false });

    return NextResponse.json({ reviews: data || [] });
  } catch (err) {
    console.error("[Reviews GET]", err);
    return NextResponse.json({ reviews: [] });
  }
}
