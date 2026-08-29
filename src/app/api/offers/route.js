import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ offers: [] }, { status: 401 });

  const supabase = createClient(url, serviceKey);
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "received";

  let dbQuery = supabase
    .from("offers")
    .select("*, product:products(*, seller:users(*)), from_user:users!offers_from_user_id_fkey(*), to_user:users!offers_to_user_id_fkey(*)");

  if (type === "received") {
    dbQuery = dbQuery.eq("to_user_id", user.id);
  } else if (type === "sent") {
    dbQuery = dbQuery.eq("from_user_id", user.id);
  }

  const { data } = await dbQuery.order("created_at", { ascending: false }).limit(100);

  return NextResponse.json({ offers: data || [] });
}

export async function POST(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No auth" }, { status: 401 });

  const { productId, amount, message } = await req.json();
  if (!productId || !amount) {
    return NextResponse.json({ error: "productId y amount son obligatorios" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, seller, title, price")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  }

  const { data: offer, error: insertError } = await supabase
    .from("offers")
    .insert([{
      product_id: productId,
      from_user_id: user.id,
      to_user_id: product.seller,
      amount,
      original_price: product.price,
      status: "pending",
      message: message || "",
    }])
    .select()
    .single();

  if (insertError) {
    console.warn("[Offers API] Error al insertar:", insertError.message);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase.from("notifications").insert({
    user_id: product.seller,
    type: "offer",
    title: "Nueva oferta",
    body: `Han ofertado ${Number(amount).toFixed(2)} € por "${product.title}"`,
    link: `/product/${productId}`,
    read: false,
  });

  return NextResponse.json({ success: true, offer });
}
