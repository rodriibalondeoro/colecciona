import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia",
  });
}

const PREMIUM_AMOUNT = 499; // 4.99 EUR en centimos

export async function POST(req) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey);

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    // Verificar si ya es premium
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub?.status === "active") {
      return NextResponse.json({ error: "Ya eres premium" }, { status: 400 });
    }

    // Crear o recuperar Stripe Customer
    const { data: priv } = await supabase
      .from("user_private")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = priv?.stripe_customer_id;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;

      await supabase
        .from("user_private")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    // Crear Checkout Session para suscripción
    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Colecciona Premium",
              description: "Precio inteligente, alertas, comisión reducida",
            },
            unit_amount: PREMIUM_AMOUNT,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.get("origin")}/profile?premium=success`,
      cancel_url: `${req.headers.get("origin")}/profile?premium=cancel`,
      metadata: { user_id: user.id },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[Stripe Subscribe Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
