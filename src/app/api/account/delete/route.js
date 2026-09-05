import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = "card-images";

// Active order states that block account deletion
const ACTIVE_ORDER_STATES = ["PENDING", "PAYMENT_PROCESSING", "CAPTURING", "PAID", "PREPARING", "SHIPPED", "DELIVERED"];
// Active trade states that block account deletion
const ACTIVE_TRADE_STATES = ["PROPOSED", "ACCEPTED", "SHIPPING_PENDING", "SHIPPED", "RECEIVED", "DISPUTED"];
// Active offer states that block account deletion
const ACTIVE_OFFER_STATES = ["pending", "accepted"];

export async function DELETE(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = await rateLimit(`account-delete:${user.id}`, { limit: 3, windowMs: 3600000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });
    }

    const serviceClient = createClient(url, serviceKey);
    const userClient = createUserClient(token);
    const userId = user.id;

    // Gate 1: active orders (buyer or seller)
    const { data: activeOrders } = await userClient
      .from("orders")
      .select("id")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .in("status", ACTIVE_ORDER_STATES)
      .limit(1);
    if (activeOrders && activeOrders.length > 0) {
      return NextResponse.json(
        { error: "No puedes eliminar tu cuenta con pedidos activos. Espera a que se completen o cancelen." },
        { status: 409 }
      );
    }

    // Gate 2: active trades (proposer or receiver)
    const { data: activeTrades } = await userClient
      .from("trade_proposals")
      .select("id")
      .or(`proposer_id.eq.${userId},receiver_id.eq.${userId}`)
      .in("status", ACTIVE_TRADE_STATES)
      .limit(1);
    if (activeTrades && activeTrades.length > 0) {
      return NextResponse.json(
        { error: "No puedes eliminar tu cuenta con intercambios activos." },
        { status: 409 }
      );
    }

    // Gate 3: pending/accepted offers (as buyer or recipient)
    const { data: activeOffers } = await userClient
      .from("offers")
      .select("id")
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .in("status", ACTIVE_OFFER_STATES)
      .limit(1);
    if (activeOffers && activeOffers.length > 0) {
      return NextResponse.json(
        { error: "No puedes eliminar tu cuenta con ofertas pendientes." },
        { status: 409 }
      );
    }

    // Anonymize PII (conserves transactional rows)
    const { error: anonError } = await serviceClient.rpc("anonymize_user", { p_user_id: userId });
    if (anonError) {
      console.error("[Account Delete] anonymize_user error:", anonError.message);
      return NextResponse.json({ error: "Error al anonimizar los datos" }, { status: 500 });
    }

    // Delete personal storage files (best-effort)
    try {
      const { data: files } = await serviceClient.storage.from(STORAGE_BUCKET).list(`${userId}`, {
        limit: 500,
      });
      const paths = (files || []).map((f) => `${userId}/${f.name}`);
      // list() returns top-level entries; cards are under userId/cards/
      const removePaths = [`${userId}`];
      // Build paths including subdirectories (cards/ folder)
      for (const f of files || []) {
        if (f.id !== null && f.name.indexOf(".") === -1) {
          // Likely a directory (e.g., cards) — no dot in folder name
          removePaths.push(`${userId}/${f.name}`);
        }
      }
      for (const p of removePaths) {
        const { error: rmError } = await serviceClient.storage.from(STORAGE_BUCKET).remove([p]);
        if (rmError) console.warn("[Account Delete] storage remove:", rmError.message);
      }
    } catch (storageErr) {
      console.warn("[Account Delete] storage cleanup:", storageErr.message);
    }

    // Ban auth user (invalidates session + prevents re-login), conserving auth.users row
    // for FK integrity. 100 years ban ≈ permanent.
    const { error: banError } = await serviceClient.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
    });
    if (banError) {
      console.error("[Account Delete] ban error:", banError.message);
    }

    return NextResponse.json({
      success: true,
      message: "Cuenta eliminada. Tus datos personales han sido anonimizados.",
    });
  } catch (err) {
    console.error("[Account Delete] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
