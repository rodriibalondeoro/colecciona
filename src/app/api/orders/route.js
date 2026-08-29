import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const COMMISSION_RATE = 0.08;

export async function POST(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`order:${ip}`, { limit: 5, windowMs: 60000 });
    if (!rl.allowed) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

    const body = await req.json();
    const supabase = createClient(url, key);

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("price, seller, title, image")
      .eq("id", body.productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    const price = product.price;
    const shipping = body.shipping || 0;
    const commission = price * COMMISSION_RATE;
    const total = price + shipping;

    const { data, error: insertError } = await supabase
      .from("orders")
      .insert({
        product_id: body.productId,
        seller_id: product.seller,
        buyer_id: user.id,
        price,
        shipping,
        commission,
        total,
        shipping_method: body.shippingMethod || "Sobre acolchado Correos",
        shipping_address: body.shippingAddress || "",
        status: "paid",
      })
      .select()
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    await supabase.from("notifications").insert([
      {
        user_id: product.seller,
        type: "sale",
        title: "¡Nueva venta!",
        body: `Tu carta "${product.title}" se vendió por ${price.toFixed(2)} €`,
        link: "/orders",
      },
      {
        user_id: user.id,
        type: "purchase",
        title: "Compra confirmada",
        body: `Compraste "${product.title}" por ${price.toFixed(2)} €`,
        link: "/orders",
      },
    ]);

    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error("Error creating order:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ orders: [] });

    const supabase = createClient(url, key);
    const { data } = await supabase
      .from("orders")
      .select("*, product:products(id, title, image, price), seller:users!orders_seller_id_fkey(name, username), buyer:users!orders_buyer_id_fkey(name, username)")
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    return NextResponse.json({ orders: data || [] });
  } catch (err) {
    console.error("Error fetching orders:", err);
    return NextResponse.json({ orders: [] });
  }
}
