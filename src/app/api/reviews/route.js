import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json();
    const supabase = createClient(url, key);

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, buyer_id, seller_id")
      .eq("id", body.orderId)
      .single();

    if (!order || order.status !== "completed") {
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
      await supabase.from("users").update({ rating: rounded }).eq("id", reviewedId);
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

    const supabase = createClient(url, key);
    const { data } = await supabase
      .from("reviews")
      .select(
        "*, reviewer:users!reviews_reviewer_id_fkey(name, username)"
      )
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false });

    return NextResponse.json({ reviews: data || [] });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    return NextResponse.json({ reviews: [] });
  }
}
