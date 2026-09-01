import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export async function POST(req) {
  try {
    const { amount, orderId, buyerId } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "eur",
      payment_method_types: ["card"],
      capture_method: "manual",
      metadata: { orderId, buyerId },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error creating PaymentIntent:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
