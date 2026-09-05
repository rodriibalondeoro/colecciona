import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";
import { ORDER_STATES, normalizeOrderStatus } from "@/lib/orderStates";
import { rateLimit } from "@/lib/rateLimit";

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
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    // Validate input types
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, buyer_id, seller_id")
      .eq("id", body.orderId)
      .single();

    if (!order || normalizeOrderStatus(order.status) !== ORDER_STATES.COMPLETED) {
      return NextResponse.json(
        { error: "Solo puedes reseñar pedidos completados" },
        { status: 400 }
      );
    }

    if (order.buyer_id !== user.id && order.seller_id !== user.id) {
      return NextResponse.json(
        { error: "No participas en este pedido" },
        { status: 403 }
      );
    }

    const reviewedId =
      user.id === order.buyer_id ? order.seller_id : order.buyer_id;

    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("order_id", body.orderId)
      .eq("reviewer_id", user.id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "Ya has reseñado este pedido" },
        { status: 400 }
      );
    }

    const { data, error: insertError } = await supabase
      .from("reviews")
      .insert({
        order_id: body.orderId,
        reviewer_id: user.id,
        target_user_id: reviewedId,
        rating: body.rating,
        comment: body.comment || null,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Error creando la reseña" }, { status: 500 });
    }

    // Update rating via SQL AVG RPC (service_role — backend only)
    const serviceClient = (await import("@supabase/supabase-js")).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { error: ratingError } = await serviceClient.rpc("update_reviewer_rating", {
      p_user_id: reviewedId,
    });
    if (ratingError) {
      console.error("[Reviews] Failed to update rating:", ratingError.message);
    }

    await supabase.from("notifications").insert({
      user_id: reviewedId,
      type: "review",
      title: "Nueva resena",
      body: `Te dejaron una resena de ${body.rating} estrellas`,
      link: "/orders",
    });

    return NextResponse.json({ success: true, review: data });
  } catch (err) {
    console.error("Error creating review:", err);
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

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ reviews: [] });
    const { data } = await supabase
      .from("reviews")
      .select(
        "*, reviewer:profiles!reviews_reviewer_id_fkey(name, username)"
      )
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false });

    return NextResponse.json({ reviews: data || [] });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    return NextResponse.json({ reviews: [] });
  }
}
