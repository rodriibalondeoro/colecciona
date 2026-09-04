import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

function mapRpcError(message) {
  if (!message) return { status: 500 };
  const codeMatch = message.match(/^\[([A-Z_]+)\]/);
  const code = codeMatch ? codeMatch[1] : null;
  switch (code) {
    case "AUTH_REQUIRED": return { status: 401 };
    case "NOT_OWNER": return { status: 403 };
    case "ITEM_NOT_FOUND": return { status: 404 };
    case "INVALID_TITLE": return { status: 400 };
    case "INVALID_PRICE": return { status: 400 };
    case "INSUFFICIENT_QUANTITY": return { status: 409 };
    default: return { status: 500 };
  }
}

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`publish:${ip}`, { limit: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json();

    // Call atomic RPC (locks collection_item, checks availability, inserts product)
    const supabase = createUserClient(token);
    const { data, error: rpcError } = await supabase.rpc("publish_product", {
      p_title: body.title,
      p_price: Number(body.price),
      p_image: body.image || "",
      p_category: body.category || "",
      p_condition: body.condition || "",
      p_code: body.code || null,
      p_rarity: body.rarity || null,
      p_description: body.description || null,
      p_set_name: body.set || "",
      p_language: body.language || "",
      p_year: body.year || null,
      p_collection_item_id: body.collection_item_id || null,
    });

    if (rpcError) {
      console.warn("[API /publish] RPC error:", rpcError.message);
      const mapped = mapRpcError(rpcError.message);
      return NextResponse.json({ error: rpcError.message }, { status: mapped.status });
    }

    // Notify users who have this card as MISSING (best-effort)
    try {
      const cardTitle = body.title || "";
      const serviceClient = (await import("@supabase/supabase-js")).createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const { data: missingHolders, error: queryError } = await serviceClient
        .from("collection_items")
        .select("user_id, card_name")
        .eq("status", "MISSING")
        .ilike("card_name", cardTitle)
        .neq("user_id", user.id);

      if (queryError) {
        console.warn("[API /publish] Query error:", queryError.message);
      } else if (missingHolders && missingHolders.length > 0) {
        const notifications = missingHolders.map(h => ({
          user_id: h.user_id,
          type: "price_alert",
          title: "Cromo de tu lista de faltas disponible",
          message: `"${cardTitle}" acaba de ser publicado a ${body.price}€.`,
          data: { product_id: data.id, card_name: h.card_name },
          read: false,
        }));
        const { error: insertError } = await serviceClient.from("notifications").insert(notifications);
        if (insertError) console.warn("[API /publish] Notification error:", insertError.message);
      }
    } catch {}

    return NextResponse.json({ success: true, product: data });
  } catch (err) {
    console.error("[API /publish] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
