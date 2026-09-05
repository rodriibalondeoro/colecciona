import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

function mapRpcError(message) {
  if (!message) return { status: 500, code: "INTERNAL" };
  const codeMatch = message.match(/^\[([A-Z_]+)\]/);
  const code = codeMatch ? codeMatch[1] : null;
  switch (code) {
    case "OFFER_NOT_FOUND": return { status: 404, code };
    case "PRODUCT_NOT_FOUND": return { status: 404, code };
    case "AUTH_REQUIRED": return { status: 401, code };
    case "NOT_SELLER": return { status: 403, code };
    case "NOT_BUYER": return { status: 403, code };
    case "NOT_RECIPIENT": return { status: 403, code };
    case "NOT_SENDER": return { status: 403, code };
    case "OFFER_NOT_PENDING": return { status: 409, code };
    case "PRODUCT_UNAVAILABLE": return { status: 409, code };
    case "PRODUCT_RACE": return { status: 409, code };
    case "OFFER_RACE": return { status: 409, code };
    case "INVALID_AMOUNT": return { status: 400, code };
    case "MESSAGE_TOO_LONG": return { status: 400, code };
    case "CANNOT_SELF_OFFER": return { status: 400, code };
    case "OFFER_EXISTS": return { status: 409, code };
    default: return { status: 500, code };
  }
}

export async function PATCH(req, { params }) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rl = await rateLimit(`offers:${user.id}`, { limit: 10, windowMs: 60000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
  }

  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  const { action, amount, message } = body;

  if (!action) {
    return NextResponse.json({ error: "action es obligatorio (accept, reject, cancel, counter)" }, { status: 400 });
  }

  const supabase = createUserClient(token);
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
      const parsedAmount = typeof amount === "string" ? Number(amount) : amount;
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return NextResponse.json({ error: "Importe inválido" }, { status: 400 });
      }
      if (message !== undefined && message !== null) {
        if (typeof message !== "string") {
          return NextResponse.json({ error: "message debe ser texto" }, { status: 400 });
        }
        if (message.length > 1000) {
          return NextResponse.json({ error: "Mensaje demasiado largo (máximo 1000 caracteres)" }, { status: 400 });
        }
      }
      const result = await supabase.rpc("counter_offer", {
        p_offer_id: id,
        p_amount: parsedAmount,
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
