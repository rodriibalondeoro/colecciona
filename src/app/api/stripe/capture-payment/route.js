import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const { paymentIntentId } = await req.json();

    if (!paymentIntentId) {
      return NextResponse.json({ error: "paymentIntentId es obligatorio" }, { status: 400 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);

    const supabase = createClient(url, key);

    // Atomic: order→PAID + products→SOLD via single RPC
    const { data, error: rpcError } = await supabase.rpc("mark_products_sold_by_payment_intent", {
      p_payment_intent_id: paymentIntentId,
    });

    if (rpcError) {
      console.error("[Capture] RPC error:", rpcError.message);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("seller_id")
      .eq("payment_intent_id", paymentIntentId)
      .single();

    if (order?.seller_id) {
      await supabase.from("notifications").insert({
        user_id: order.seller_id,
        type: "payment_received",
        title: "Pago recibido",
        body: "El pago de tu venta ha sido capturado y los fondos están disponibles.",
      });
    }

    return NextResponse.json({
      success: true,
      status: paymentIntent.status,
    });
  } catch (error) {
    console.error("Error en Stripe Capture API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
