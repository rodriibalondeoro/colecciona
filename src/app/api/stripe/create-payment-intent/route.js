import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { ORDER_STATES } from "@/lib/orderStates";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const COMMISSION_RATE = 0.08;
const PROTECTION_FEE_CENTS = 250; // 2.50 € flat comprador

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const { cartItems, shippingAddress } = await req.json();

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return NextResponse.json({ error: "La cesta está vacía" }, { status: 400 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const supabase = createClient(url, key);

    const ids = [...new Set(cartItems.map((i) => i.productId).filter(Boolean))];
    const reservedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { data: products, error: productError } = await supabase
      .rpc("reserve_products_for_checkout", {
        p_product_ids: ids,
        p_buyer_id: user.id,
        p_reserved_until: reservedUntil,
      });

    if (productError || !products) {
      return NextResponse.json({ error: "Uno o más productos ya no están disponibles" }, { status: 409 });
    }

    const productMap = {};
    for (const p of products) productMap[p.id] = p;

    // Totales
    let priceCents = 0;
    let shippingCents = 0;
    let commissionCents = 0;

    const orderLines = [];
    for (const item of cartItems) {
      const product = productMap[item.productId];
      if (!product) {
        return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      }

      const itemPrice = Math.round(product.price * 100);
      const itemShipping = Math.round((item.shipping || 0) * 100);
      const itemCommission = Math.round(itemPrice * COMMISSION_RATE);
      const itemTotal = itemPrice + itemShipping;

      priceCents += itemPrice;
      shippingCents += itemShipping;
      commissionCents += itemCommission;

      orderLines.push({
        product_id: product.id,
        seller_id: product.seller,
        buyer_id: user.id,
        price: product.price,
        shipping: itemShipping / 100,
        commission: itemCommission / 100,
        net_earnings: (itemPrice - itemCommission) / 100,
        total: itemTotal / 100,
        shipping_method: item.shippingMethod || "Sobre acolchado Correos",
        shipping_address: shippingAddress || "",
        status: ORDER_STATES.PAYMENT_PROCESSING,
      });
    }

    const totalCents = priceCents + shippingCents + commissionCents + PROTECTION_FEE_CENTS;

    const stripe = getStripe();
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "eur",
        payment_method_types: ["card"],
        capture_method: "manual",
        metadata: {
          buyerId: user.id,
          productIds: ids.join(","),
        },
      });
    } catch (stripeError) {
      await supabase
        .from("products")
        .update({ status: "ACTIVE", reserved_by: null, reserved_until: null })
        .in("id", ids)
        .eq("reserved_by", user.id)
        .eq("status", "RESERVED");
      throw stripeError;
    }

    // Insertar órdenes pendientes ligadas al PaymentIntent
    const { error: orderError } = await supabase.from("orders").insert(
      orderLines.map((o) => ({ ...o, payment_intent_id: paymentIntent.id }))
    );

    if (orderError) {
      console.error("[Stripe] Error creando orders:", orderError);
      await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
      await supabase
        .from("products")
        .update({ status: "ACTIVE", reserved_by: null, reserved_until: null })
        .in("id", ids)
        .eq("reserved_by", user.id)
        .eq("status", "RESERVED");
      return NextResponse.json({ error: "Error creando el pedido" }, { status: 500 });
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      amount: totalCents,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error en Stripe PaymentIntent API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
