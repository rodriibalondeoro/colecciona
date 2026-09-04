import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

function mapRpcError(message) {
  if (!message) return { status: 500 };
  const codeMatch = message.match(/^\[([A-Z_]+)\]/);
  const code = codeMatch ? codeMatch[1] : null;
  switch (code) {
    case "AUTH_REQUIRED": return { status: 401 };
    case "RECEIVER_REQUIRED": return { status: 400 };
    case "SELF_TRADE": return { status: 400 };
    case "RECEIVER_NOT_FOUND": return { status: 404 };
    case "MESSAGE_TOO_LONG": return { status: 400 };
    case "NO_ITEMS": return { status: 400 };
    case "OVERLAP_ITEMS": return { status: 400 };
    case "DUPLICATE_ITEMS": return { status: 400 };
    case "INVALID_ITEM": return { status: 400 };
    case "INVALID_QUANTITY": return { status: 400 };
    case "ITEM_NOT_FOUND": return { status: 404 };
    case "NOT_OWNER": return { status: 403 };
    case "ITEM_UNAVAILABLE": return { status: 409 };
    case "INSUFFICIENT_QUANTITY": return { status: 409 };
    default: return { status: 500 };
  }
}

function validateItems(items, side) {
  if (!items?.length) return null;

  const ids = items.map((i) => i.collection_item_id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return `${side}: duplicate IDs not allowed`;
  }

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return `${side}: quantity must be a positive integer`;
    }
  }

  return null;
}

export async function GET(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ proposals: [] });

    const supabase = createUserClient(token);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const from = (page - 1) * limit;

    let query = supabase
      .from("trade_proposals")
      .select(
        `
        *,
        proposer:profiles!trade_proposals_proposer_id_fkey(id, name, username, avatar, rating),
        receiver:profiles!trade_proposals_receiver_id_fkey(id, name, username, avatar, rating),
        items:trade_proposal_items(*)
      `,
        { count: "exact" }
      )
      .or(`proposer_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    // Exclude SUPERSEDED from list (show only active versions)
    if (!status) query = query.neq("status", "SUPERSEDED");

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ proposals: data || [], total: count || 0 });
  } catch (err) {
    console.error("[Trade Proposals GET]", err);
    return NextResponse.json({ error: "Error loading trade proposals" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

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

    // Validate item format
    const proposerFmtError = validateItems(proposer_items, "proposer");
    if (proposerFmtError) {
      return NextResponse.json({ error: proposerFmtError }, { status: 400 });
    }
    const receiverFmtError = validateItems(receiver_items, "receiver");
    if (receiverFmtError) {
      return NextResponse.json({ error: receiverFmtError }, { status: 400 });
    }

    // Message length
    if (message && typeof message === "string" && message.length > 1000) {
      return NextResponse.json({ error: "Mensaje demasiado largo (máximo 1000 caracteres)" }, { status: 400 });
    }

    // Call atomic RPC — all validation, inserts, and notifications in one transaction
    const supabase = createUserClient(token);
    const { data, error: rpcError } = await supabase.rpc("create_trade_proposal", {
      p_receiver_id: receiver_id,
      p_message: message || null,
      p_proposer_items: (proposer_items || []).map((i) => ({
        collection_item_id: i.collection_item_id,
        quantity: i.quantity || 1,
      })),
      p_receiver_items: (receiver_items || []).map((i) => ({
        collection_item_id: i.collection_item_id,
        quantity: i.quantity || 1,
      })),
    });

    if (rpcError) {
      console.warn("[Trade Proposals POST] RPC error:", rpcError.message);
      const mapped = mapRpcError(rpcError.message);
      return NextResponse.json({ error: rpcError.message }, { status: mapped.status });
    }

    return NextResponse.json({ proposal: data });
  } catch (err) {
    console.error("[Trade Proposals POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
