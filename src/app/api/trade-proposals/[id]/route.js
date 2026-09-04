import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { createClient } from "@supabase/supabase-js";

function mapRpcError(message) {
  if (!message) return { status: 500 };
  const codeMatch = message.match(/^\[([A-Z_]+)\]/);
  const code = codeMatch ? codeMatch[1] : null;
  switch (code) {
    case "AUTH_REQUIRED": return { status: 401 };
    case "NOT_RECEIVER": return { status: 403 };
    case "NOT_OWNER": return { status: 403 };
    case "PROPOSAL_NOT_FOUND": return { status: 404 };
    case "ITEM_NOT_FOUND": return { status: 404 };
    case "INVALID_STATUS": return { status: 409 };
    case "ITEM_UNAVAILABLE": return { status: 409 };
    case "INSUFFICIENT_QUANTITY": return { status: 409 };
    case "OVERLAP_ITEMS": return { status: 400 };
    case "DUPLICATE_ITEMS": return { status: 400 };
    case "NO_ITEMS": return { status: 400 };
    case "INVALID_ITEM": return { status: 400 };
    case "INVALID_QUANTITY": return { status: 400 };
    case "MESSAGE_TOO_LONG": return { status: 400 };
    default: return { status: 500 };
  }
}

export async function GET(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const supabase = createUserClient(token);

    const { data: proposal, error } = await supabase
      .from("trade_proposals")
      .select(`
        *,
        proposer:profiles!trade_proposals_proposer_id_fkey(id, name, username, avatar, rating, location),
        receiver:profiles!trade_proposals_receiver_id_fkey(id, name, username, avatar, rating, location),
        items:trade_proposal_items(
          *,
          collection_item:collection_items(card_name, card_number, image_url, set_name)
        )
      `)
      .eq("id", id)
      .single();

    if (error || !proposal) {
      return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
    }

    if (proposal.proposer_id !== user.id && proposal.receiver_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    // Get history
    const { data: history } = await supabase
      .from("trade_history")
      .select("*, actor:users(name, username)")
      .eq("proposal_id", id)
      .order("created_at", { ascending: true });

    return NextResponse.json({ proposal: { ...proposal, history: history || [] } });
  } catch (err) {
    console.error("[Trade Proposal Detail GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json();
    const { status: newStatus, message, new_proposer_items, new_receiver_items } = body;

    if (!newStatus) {
      return NextResponse.json({ error: "status es obligatorio" }, { status: 400 });
    }

    // Validate message length
    if (message && typeof message === "string" && message.length > 1000) {
      return NextResponse.json({ error: "Mensaje demasiado largo (máximo 1000 caracteres)" }, { status: 400 });
    }

    // COUNTERED requires counter-offer RPC (atomic versioning)
    if (newStatus === "COUNTERED") {
      if (!new_proposer_items?.length && !new_receiver_items?.length) {
        return NextResponse.json({ error: "Contraoferta debe incluir al menos un elemento" }, { status: 400 });
      }

      const supabase = createUserClient(token);
      const { data, error: rpcError } = await supabase.rpc("counter_offer_proposal", {
        p_proposal_id: id,
        p_message: message || null,
        p_new_proposer_items: new_proposer_items.map((i) => ({
          collection_item_id: i.collection_item_id,
          quantity: i.quantity || 1,
        })),
        p_new_receiver_items: (new_receiver_items || []).map((i) => ({
          collection_item_id: i.collection_item_id,
          quantity: i.quantity || 1,
        })),
      });

      if (rpcError) {
        console.warn("[Trade Proposal PATCH] Counter-offer error:", rpcError.message);
        const mapped = mapRpcError(rpcError.message);
        return NextResponse.json({ error: rpcError.message }, { status: mapped.status });
      }

      return NextResponse.json({ ok: true, result: data });
    }

    // ACCEPTED requires accept RPC (receiver item availability check)
    if (newStatus === "ACCEPTED") {
      const supabase = createUserClient(token);
      const { data, error: rpcError } = await supabase.rpc("accept_trade_proposal", {
        p_proposal_id: id,
      });

      if (rpcError) {
        console.warn("[Trade Proposal PATCH] Accept error:", rpcError.message);
        const mapped = mapRpcError(rpcError.message);
        return NextResponse.json({ error: rpcError.message }, { status: mapped.status });
      }

      return NextResponse.json({ ok: true, result: data });
    }

    // All other status transitions: simple update (DB trigger validates)
    const supabase = createUserClient(token);

    const { data: proposal } = await supabase
      .from("trade_proposals")
      .select("*")
      .eq("id", id)
      .single();

    if (!proposal) {
      return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
    }

    if (proposal.proposer_id !== user.id && proposal.receiver_id !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const updates = { status: newStatus };
    if (message) updates.message = message;

    const { error: updateError } = await supabase
      .from("trade_proposals")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      console.warn("[Trade Proposal PATCH] Update error:", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    // Notify the other party (best-effort)
    const otherUserId = user.id === proposal.proposer_id ? proposal.receiver_id : proposal.proposer_id;
    const statusLabels = {
      ACCEPTED: "aceptó tu propuesta",
      CANCELLED: "canceló la propuesta",
      SHIPPED: "marcó como enviado",
      SHIPPING_PENDING: "confirmó envío pendiente",
      RECEIVED: "confirmó recepción",
      COMPLETED: "completó el intercambio",
      DISPUTED: "abrió una disputa",
    };

    if (statusLabels[newStatus]) {
      try {
        const serviceClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        await serviceClient.from("notifications").insert({
          user_id: otherUserId,
          type: "trade_update",
          title: "Actualización de intercambio",
          message: `${user.name || "Alguien"} ${statusLabels[newStatus]}`,
          data: { link: "/intercambios" },
        });
      } catch {}
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("[Trade Proposal PATCH]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
