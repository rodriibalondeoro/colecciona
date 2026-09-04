import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";
import { getStripe } from "@/lib/stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) return NextResponse.json({ error: authError }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`checkout:${ip}`, { limit: 3, windowMs: 60000 });
    if (!rl.allowed) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

    const { productIds, shippingMethod, shippingAddress } = await req.json();

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: "No hay productos seleccionados" }, { status: 400 });
    }

    if (productIds.length > 50) {
      return NextResponse.json({ error: "Demasiados productos (máximo 50)" }, { status: 400 });
    }

    // Validate all IDs are UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!productIds.every(id => typeof id === "string" && UUID_RE.test(id))) {
      return NextResponse.json({ error: "ID de producto inválido" }, { status: 400 });
    }

    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe no configurado. Checkout no disponible." }, { status: 503 });
    }

    // IDENTITY SEPARATION:
    // - userClient: RPCs that require auth.uid() (reserve_products_for_checkout, create_checkout_order)
    // - serviceClient: Backend-only operations (rollback_checkout, direct UPDATEs)
    const token = extractToken(req);
    const userClient = createUserClient(token);
    const serviceClient = createClient(url, serviceKey);

    const uniqueIds = [...new Set(productIds)];

    // 1. Reserve products via RPC (requires auth.uid() = user)
    const reservedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: reserveError } = await userClient
      .rpc("reserve_products_for_checkout", {
        p_product_ids: uniqueIds,
        p_buyer_id: user.id,
        p_reserved_until: reservedUntil,
      });

    if (reserveError) {
      return NextResponse.json({ error: "Uno o más productos ya no están disponibles" }, { status: 409 });
    }

    // 2. Create order via RPC (requires auth.uid() = user)
    const { data: orderResult, error: orderError } = await userClient
      .rpc("create_checkout_order", {
        p_product_ids: uniqueIds,
        p_shipping_method: shippingMethod || "standard",
        p_shipping_address: shippingAddress || "",
      });

    if (orderError || !orderResult) {
      return NextResponse.json({ error: "Error creando el pedido" }, { status: 500 });
    }

    const orderId = orderResult.order_id;
    const totalCents = Math.round(orderResult.total * 100);

    // 3. Create Stripe PaymentIntent
    // IDEMPOTENCY KEY: Prevents duplicate PI creation on retry/double-click/network retry.
    // Stripe returns the SAME PaymentIntent if idempotencyKey matches within 24 hours.
    // This ensures: 1 ORDER → at most 1 PI created (even across retries).
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency: "eur",
          payment_method_types: ["card"],
          capture_method: "manual",
          metadata: { orderId, buyerId: user.id, productIds: uniqueIds.join(",") },
        },
        {
          idempotencyKey: `checkout:${orderId}`,
        }
      );
    } catch (stripeError) {
      console.error("[Checkout] Stripe error:", stripeError);
      // Rollback via service role (rollback_checkout requires auth.uid() IS NULL = system only)
      await serviceClient.rpc("rollback_checkout", { p_order_id: orderId });
      return NextResponse.json({ error: "Error al procesar el pago" }, { status: 500 });
    }

    // 4. Link payment intent to order (service role — no auth.uid() needed for direct UPDATE)
    // RACE WINDOW: Between PI creation (step 3) and this update, a webhook could arrive
    // with order still in PENDING status. confirm_payment would fail ("not PAYMENT_PROCESSING").
    // This is safe: Stripe retries webhooks with exponential backoff (up to 3 days).
    // By the next retry, order will be in PAYMENT_PROCESSING.
    const { error: updateError } = await serviceClient
      .from("orders")
      .update({
        payment_intent_id: paymentIntent.id,
        status: "PAYMENT_PROCESSING",
        payment_processing_started_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateError) {
      console.error("[Checkout] Failed to link PI to order:", updateError.message);
      // DO NOT return clientSecret — the order is in an inconsistent state.
      // The PI exists in Stripe but isn't linked to the order.
      // The cron recovery (orphaned PENDING orders) will find it via metadata.orderId.
      // We return 500 so the user knows the checkout wasn't fully prepared.
      return NextResponse.json({ error: "Error preparando el pago" }, { status: 500 });
    }

    return NextResponse.json({
      orderId,
      clientSecret: paymentIntent.client_secret,
      amount: totalCents,
    });
  } catch (error) {
    console.error("[Checkout] Error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
