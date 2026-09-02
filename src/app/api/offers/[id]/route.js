import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mapRpcError(message) {
  if (!message) return { status: 500, code: "INTERNAL" };
  const m = message.toLowerCase();
  if (m.includes("not found")) return { status: 404, code: "NOT_FOUND" };
  if (m.includes("not authenticated") || m.includes("authentication required")) return { status: 401, code: "UNAUTHENTICATED" };
  if (m.includes("not authorized") || m.includes("only the seller") || m.includes("only the buyer") || m.includes("you are not")) return { status: 403, code: "FORBIDDEN" };
  if (m.includes("not pending") || m.includes("no longer available") || m.includes("cannot") || m.includes("amount must be")) return { status: 409, code: "CONFLICT" };
  return { status: 500, code: "INTERNAL" };
}

export async function PATCH(req, { params }) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action, amount, message } = body;

  if (!action) {
    return NextResponse.json({ error: "action es obligatorio (accept, reject, cancel, counter)" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);
  let rpcResult;

  switch (action) {
    case "accept": {
      const result = await supabase.rpc("accept_offer", { p_offer_id: id });
      rpcResult = result;
      break;
    }
    case "reject": {
      const result = await supabase.rpc("reject_offer", { p_offer_id: id });
      rpcResult = result;
      break;
    }
    case "cancel": {
      const result = await supabase.rpc("cancel_offer", { p_offer_id: id });
      rpcResult = result;
      break;
    }
    case "counter": {
      if (!amount || amount <= 0) {
        return NextResponse.json({ error: "amount es obligatorio para contraoferta" }, { status: 400 });
      }
      const result = await supabase.rpc("counter_offer", {
        p_offer_id: id,
        p_amount: amount,
        p_message: message || "",
      });
      rpcResult = result;
      break;
    }
    default:
      return NextResponse.json({ error: `Acción desconocida: ${action}` }, { status: 400 });
  }

  if (rpcResult.error) {
    const mapped = mapRpcError(rpcResult.error.message);
    return NextResponse.json({ error: rpcResult.error.message }, { status: mapped.status });
  }

  return NextResponse.json({ success: true, result: rpcResult.data });
}
