import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    console.warn(`[Offers API] ${action} error:`, rpcResult.error.message);
    return NextResponse.json({ error: rpcResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, result: rpcResult.data });
}
