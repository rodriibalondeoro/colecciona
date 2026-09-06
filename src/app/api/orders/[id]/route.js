import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { ORDER_STATES, canTransitionOrder, normalizeOrderStatus } from "@/lib/orderStates";
import { rateLimit } from "@/lib/rateLimit";

function mapRpcError(message) {
  if (!message) return { status: 500, code: "INTERNAL" };
  const codeMatch = message.match(/^\[([A-Z_]+)\]/);
  const code = codeMatch ? codeMatch[1] : null;
  switch (code) {
    case "ORDER_NOT_FOUND": return { status: 404, code };
    case "AUTH_REQUIRED": return { status: 401, code };
    case "NOT_SELLER": return { status: 403, code };
    case "NOT_BUYER": return { status: 403, code };
    case "NOT_PARTICIPANT": return { status: 403, code };
    case "ORDER_NOT_PAID": return { status: 409, code };
    case "ORDER_NOT_PREPARING": return { status: 409, code };
    case "ORDER_NOT_SHIPPED": return { status: 409, code };
    case "ORDER_NOT_DELIVERED": return { status: 409, code };
    case "INVALID_TRACKING": return { status: 400, code };
    default: return { status: 500, code };
  }
}

export async function PATCH(req, { params }) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const rl = await rateLimit(`order-detail:${user.id}`, { limit: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const nextStatus = body.status ? normalizeOrderStatus(body.status) : null;
    const trackingCode = body.tracking_code || null;

    const supabase = createUserClient(token);

    let rpcName;
    let rpcParams = { p_order_id: id };

    switch (nextStatus) {
      case ORDER_STATES.PREPARING:
        rpcName = "mark_order_preparing";
        break;
      case ORDER_STATES.SHIPPED:
        rpcName = "mark_order_shipped";
        rpcParams.p_tracking_number = trackingCode;
        break;
      case ORDER_STATES.DELIVERED:
        rpcName = "confirm_order_delivery";
        break;
      case ORDER_STATES.COMPLETED:
        rpcName = "complete_order";
        break;
      default:
        return NextResponse.json({ error: "Transición de estado no soportada" }, { status: 400 });
    }

    const { data, error: rpcError } = await supabase.rpc(rpcName, rpcParams);

    if (rpcError) {
      const mapped = mapRpcError(rpcError.message);
      return NextResponse.json({ error: "Error al actualizar el pedido" }, { status: mapped.status });
    }

    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error("Error updating order:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
