import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function POST(req, { params }) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const body = await req.json();
    const { proposer_items, receiver_items, message } = body;

    // Verify proposal exists and user is participant
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

    if (!["PROPOSED", "COUNTERED"].includes(proposal.status)) {
      return NextResponse.json({ error: "No se puede contraofertar en esta propuesta" }, { status: 400 });
    }

    // Delete old items
    await supabase.from("trade_proposal_items").delete().eq("proposal_id", id);

    // Insert new proposer items
    if (proposer_items?.length) {
      await supabase.from("trade_proposal_items").insert(
        proposer_items.map(i => ({
          proposal_id: id,
          collection_item_id: i.collection_item_id,
          user_id: proposal.proposer_id,
          quantity: i.quantity || 1,
          side: "proposer",
        }))
      );
    }

    // Insert new receiver items
    if (receiver_items?.length) {
      await supabase.from("trade_proposal_items").insert(
        receiver_items.map(i => ({
          proposal_id: id,
          collection_item_id: i.collection_item_id,
          user_id: proposal.receiver_id,
          quantity: i.quantity || 1,
          side: "receiver",
        }))
      );
    }

    // Update proposal status
    await supabase
      .from("trade_proposals")
      .update({
        status: "COUNTERED",
        message: message || proposal.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    // Log history
    await supabase.from("trade_history").insert({
      proposal_id: id,
      actor_id: user.id,
      action: "countered",
      old_status: proposal.status,
      new_status: "COUNTERED",
      details: {
        message: message || null,
        proposer_items_count: proposer_items?.length || 0,
        receiver_items_count: receiver_items?.length || 0,
      },
    });

    // Notify the other party
    const otherUserId = user.id === proposal.proposer_id ? proposal.receiver_id : proposal.proposer_id;
    await supabase.from("notifications").insert({
      user_id: otherUserId,
      type: "trade_update",
      title: "Contraoferta recibida",
      body: `${user.name || "Alguien"} modificó la propuesta de intercambio`,
      link: `/intercambios`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Trade Counter POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
