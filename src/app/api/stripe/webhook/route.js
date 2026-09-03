import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const runtime = "nodejs";

export async function POST(req) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    console.error("[Webhook] No stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  if (!webhookSecret) {
    console.error("[Webhook] STRIPE_WEBHOOK_SECRET no configurado");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[Webhook] Firma inválida:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`[Webhook] Evento recibido: ${event.type}`);

  const supabase = createClient(url, key);

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      console.log(`[Webhook] Payment succeeded: ${pi.id}`);
      // IDEMPOTENT: confirm_payment returns "Already confirmed" if order already PAID.
      // RACE WINDOW: If webhook arrives before order status is updated to PAYMENT_PROCESSING
      // (between PI creation and order update), confirm_payment will fail with
      // "not PAYMENT_PROCESSING". Stripe retries webhooks (up to 3 days), so this is safe.
      const { data, error } = await supabase.rpc("mark_products_sold_by_payment_intent", {
        p_payment_intent_id: pi.id,
      });
      if (error) console.error("[Webhook] Error marking products sold:", error.message);
      else console.log("[Webhook] Order confirmed:", data);
      break;
    }
    case "payment_intent.captured": {
      const pi = event.data.object;
      console.log(`[Webhook] Payment captured: ${pi.id}`);
      const { data, error } = await supabase.rpc("mark_products_sold_by_payment_intent", {
        p_payment_intent_id: pi.id,
      });
      if (error) console.error("[Webhook] Error capturing payment:", error.message);
      else console.log("[Webhook] Payment captured:", data);
      break;
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      console.log(`[Webhook] Payment failed: ${pi.id}`);
      // IDEMPOTENT: release returns "No reservations" if order already CANCELLED/PAID.
      // If succeeded webhook arrived first, order is PAID → this is a no-op.
      const { data, error } = await supabase.rpc("release_product_reservations_by_payment_intent", {
        p_payment_intent_id: pi.id,
      });
      if (error) console.error("[Webhook] Error releasing reservations:", error.message);
      else console.log("[Webhook] Reservations released:", data);
      break;
    }
    case "charge.succeeded":
    case "charge.updated":
      console.log(`[Webhook] ${event.type} — handled`);
      break;

    // --- Premium Subscription Events ---
    case "customer.subscription.created": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription created: ${sub.id} for user ${userId}`);
      if (userId) {
        await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          status: sub.status,
          plan: "premium_monthly",
          amount: (sub.items?.data?.[0]?.price?.unit_amount || 499) / 100,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }, { onConflict: "stripe_subscription_id" });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription updated: ${sub.id} status=${sub.status}`);
      if (userId) {
        await supabase.from("subscriptions").update({
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        }).eq("stripe_subscription_id", sub.id);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      console.log(`[Webhook] Subscription deleted: ${sub.id}`);
      if (userId) {
        await supabase.from("subscriptions").update({
          status: "canceled",
        }).eq("stripe_subscription_id", sub.id);
      }
      break;
    }
    default:
      console.log(`[Webhook] Evento no manejado: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
