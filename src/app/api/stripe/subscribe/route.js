import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia",
  });
}

const PREMIUM_AMOUNT = 499; // 4.99 EUR en centimos

export async function POST(req) {
  try {
    const authHeader = req.headers.get("authorization");
    const emailHeader = req.headers.get("x-user-email");

    if (!authHeader?.startsWith("Bearer ") && !emailHeader) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(url, serviceKey);

    let userId = null;
    let userEmail = emailHeader;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) {
        userId = data.user.id;
        userEmail = data.user.email;
      }
    }

    if (!userId && userEmail) {
      const { data: users } = await supabase
        .from("users")
        .select("id")
        .eq("email", userEmail)
        .single();
      userId = users?.id;
    }

    if (!userId) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    // Verificar si ya es premium
    const { data: profile } = await supabase
      .from("users")
      .select("is_premium, stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profile?.is_premium) {
      return NextResponse.json({ error: "Ya eres premium" }, { status: 400 });
    }

    // Crear o recuperar Stripe Customer
    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: userEmail,
        metadata: { user_id: userId },
      });
      customerId = customer.id;

      await supabase
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
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
      metadata: { user_id: userId },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[Stripe Subscribe Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
