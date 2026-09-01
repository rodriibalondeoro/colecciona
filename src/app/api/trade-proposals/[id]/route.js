import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

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
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const body = await req.json();
    const { status: newStatus, message } = body;

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

    // Validate status transitions
    const validTransitions = {
      PROPOSED: ["ACCEPTED", "COUNTERED", "CANCELLED"],
      COUNTERED: ["ACCEPTED", "COUNTERED", "CANCELLED"],
      ACCEPTED: ["SHIPPING_PENDING", "CANCELLED"],
      SHIPPING_PENDING: ["SHIPPED", "CANCELLED"],
      SHIPPED: ["RECEIVED", "DISPUTED"],
      RECEIVED: ["COMPLETED", "DISPUTED"],
    };

    const allowed = validTransitions[proposal.status];
    if (!allowed || !allowed.includes(newStatus)) {
      return NextResponse.json({ error: `No se puede cambiar de ${proposal.status} a ${newStatus}` }, { status: 400 });
    }

    // Role-based restrictions
    if (["ACCEPTED", "COUNTERED", "CANCELLED", "RECEIVED", "DISPUTED"].includes(newStatus)) {
      if (proposal.receiver_id !== user.id && newStatus !== "CANCELLED") {
        return NextResponse.json({ error: "Solo el destinatario puede realizar esta acción" }, { status: 403 });
      }
    }

    if (["SHIPPED", "SHIPPING_PENDING"].includes(newStatus) && proposal.proposer_id !== user.id) {
      return NextResponse.json({ error: "Solo el proponente puede marcar envío" }, { status: 403 });
    }

    const updates = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "ACCEPTED") updates.accepted_at = new Date().toISOString();
    if (newStatus === "SHIPPED") updates.shipped_at = new Date().toISOString();
    if (newStatus === "RECEIVED") updates.received_at = new Date().toISOString();
    if (newStatus === "COMPLETED") updates.completed_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("trade_proposals")
      .update(updates)
      .eq("id", id);

    if (updateError) throw updateError;

    // Log history
    await supabase.from("trade_history").insert({
      proposal_id: id,
      actor_id: user.id,
      action: `status_changed_to_${newStatus}`,
      old_status: proposal.status,
      new_status: newStatus,
      details: { message: message || null },
    });

    // Notify the other party
    const otherUserId = user.id === proposal.proposer_id ? proposal.receiver_id : proposal.proposer_id;
    const statusLabels = {
      ACCEPTED: "aceptó tu propuesta",
      COUNTERED: "te envió una contraoferta",
      CANCELLED: "canceló la propuesta",
      SHIPPED: "marcó como enviado",
      RECEIVED: "confirmó recepción",
      COMPLETED: "completó el intercambio",
      DISPUTED: "abrió una disputa",
    };

    if (statusLabels[newStatus]) {
      await supabase.from("notifications").insert({
        user_id: otherUserId,
        type: "trade_update",
        title: "Actualización de intercambio",
        body: `${user.name || "Alguien"} ${statusLabels[newStatus]}`,
        link: `/intercambios`,
      });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("[Trade Proposal PATCH]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
