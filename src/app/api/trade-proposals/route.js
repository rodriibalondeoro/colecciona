import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ proposals: [] });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const from = (page - 1) * limit;

    let query = supabase
      .from("trade_proposals")
      .select(`
        *,
        proposer:profiles!trade_proposals_proposer_id_fkey(id, name, username, avatar, rating),
        receiver:profiles!trade_proposals_receiver_id_fkey(id, name, username, avatar, rating),
        items:trade_proposal_items(*)
      `, { count: "exact" })
      .or(`proposer_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ proposals: data || [], total: count || 0 });
  } catch (err) {
    console.error("[Trade Proposals GET]", err);
    return NextResponse.json({ proposals: [] });
  }
}

function validateItems(items, expectedUserId, side) {
  if (!items?.length) return null;

  // 1. Check for duplicate IDs
  const ids = items.map(i => i.collection_item_id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return `${side}: IDs duplicados no están permitidos`;
  }

  // 2. Check quantities are positive integers
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return `${side}: cantidad debe ser un entero positivo`;
    }
  }

  return null; // items format OK, deeper validation follows in main function
}

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const body = await req.json();
    const { receiver_id, message, proposer_items, receiver_items } = body;

    if (!receiver_id) {
      return NextResponse.json({ error: "Destinatario requerido" }, { status: 400 });
    }

    if (receiver_id === user.id) {
      return NextResponse.json({ error: "No puedes proponer un intercambio contigo mismo" }, { status: 400 });
    }

    if (!proposer_items?.length && !receiver_items?.length) {
      return NextResponse.json({ error: "Debes incluir al menos un elemento" }, { status: 400 });
    }

    // Validate item format (duplicates, quantities)
    const proposerFmtError = validateItems(proposer_items, user.id, "proposer");
    if (proposerFmtError) {
      return NextResponse.json({ error: proposerFmtError }, { status: 400 });
    }
    const receiverFmtError = validateItems(receiver_items, receiver_id, "receiver");
    if (receiverFmtError) {
      return NextResponse.json({ error: receiverFmtError }, { status: 400 });
    }

    // Verify all proposer items belong to the right user and are available
    if (proposer_items?.length) {
      const itemIds = proposer_items.map(i => i.collection_item_id);
      const { data: items } = await supabase
        .from("collection_items")
        .select("id, user_id, status, owned_quantity, trade_quantity")
        .in("id", itemIds);

      // COUNT CHECK: requested IDs must match found IDs
      if (!items || items.length !== itemIds.length) {
        const foundIds = new Set(items?.map(i => i.id) || []);
        const missing = itemIds.filter(id => !foundIds.has(id));
        return NextResponse.json({
          error: `Algunos elementos no existen: ${missing.join(", ")}`,
          status: 400,
        });
      }

      for (const item of items) {
        if (item.user_id !== user.id) {
          return NextResponse.json({ error: `Elemento ${item.id} no te pertenece` }, { status: 400 });
        }
        if (item.status === "MISSING" || item.status === "TRADED") {
          return NextResponse.json({ error: `Elemento ${item.id} no está disponible` }, { status: 400 });
        }
        const requested = proposer_items.find(i => i.collection_item_id === item.id)?.quantity || 1;
        const available = (item.owned_quantity || 0) - (item.trade_quantity || 0);
        if (requested > available) {
          return NextResponse.json({
            error: `Elemento ${item.id}: solicitas ${requested} pero solo tienes ${available} disponibles`,
            status: 400,
          });
        }
      }
    }

    // Verify all receiver items belong to the receiver and are available
    if (receiver_items?.length) {
      const itemIds = receiver_items.map(i => i.collection_item_id);
      const { data: items } = await supabase
        .from("collection_items")
        .select("id, user_id, status, owned_quantity, trade_quantity")
        .in("id", itemIds);

      // COUNT CHECK
      if (!items || items.length !== itemIds.length) {
        const foundIds = new Set(items?.map(i => i.id) || []);
        const missing = itemIds.filter(id => !foundIds.has(id));
        return NextResponse.json({
          error: `Algunos elementos del destinatario no existen: ${missing.join(", ")}`,
          status: 400,
        });
      }

      for (const item of items) {
        if (item.user_id !== receiver_id) {
          return NextResponse.json({ error: `Elemento ${item.id} no pertenece al destinatario` }, { status: 400 });
        }
        if (item.status === "MISSING" || item.status === "TRADED") {
          return NextResponse.json({ error: `Elemento ${item.id} no está disponible` }, { status: 400 });
        }
        const requested = receiver_items.find(i => i.collection_item_id === item.id)?.quantity || 1;
        const available = (item.owned_quantity || 0) - (item.trade_quantity || 0);
        if (requested > available) {
          return NextResponse.json({
            error: `Elemento ${item.id}: solicitas ${requested} pero el destinatario solo tiene ${available} disponibles`,
            status: 400,
          });
        }
      }
    }

    // Create proposal
    const { data: proposal, error: proposalError } = await supabase
      .from("trade_proposals")
      .insert({
        proposer_id: user.id,
        receiver_id,
        status: "PROPOSED",
        message: message || null,
      })
      .select()
      .single();

    if (proposalError) throw proposalError;

    // Insert proposer items
    if (proposer_items?.length) {
      await supabase.from("trade_proposal_items").insert(
        proposer_items.map(i => ({
          proposal_id: proposal.id,
          collection_item_id: i.collection_item_id,
          user_id: user.id,
          quantity: i.quantity || 1,
          side: "proposer",
        }))
      );
    }

    // Insert receiver items
    if (receiver_items?.length) {
      await supabase.from("trade_proposal_items").insert(
        receiver_items.map(i => ({
          proposal_id: proposal.id,
          collection_item_id: i.collection_item_id,
          user_id: receiver_id,
          quantity: i.quantity || 1,
          side: "receiver",
        }))
      );
    }

    // Log history
    await supabase.from("trade_history").insert({
      proposal_id: proposal.id,
      actor_id: user.id,
      action: "created",
      new_status: "PROPOSED",
      details: { message: message || null },
    });

    // Send notification
    await supabase.from("notifications").insert({
      user_id: receiver_id,
      type: "trade_proposal",
      title: "Nueva propuesta de intercambio",
      body: `${user.name || "Alguien"} te propuso un intercambio`,
      link: `/intercambios`,
    });

    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("[Trade Proposals POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
