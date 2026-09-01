import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";
import { ORDER_STATES, normalizeOrderStatus } from "@/lib/orderStates";

export async function POST(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json();
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

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
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const { data: allReviews } = await supabase
      .from("reviews")
      .select("rating")
      .eq("target_user_id", reviewedId);

    if (allReviews && allReviews.length > 0) {
      const avg = allReviews.reduce((acc, r) => acc + r.rating, 0) / allReviews.length;
      const rounded = Math.round(avg * 100) / 100;
      await supabase.from("profiles").update({ rating: rounded }).eq("id", reviewedId);
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
