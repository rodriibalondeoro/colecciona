import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ offers: [] }, { status: 401 });

  const supabase = createClient(url, serviceKey);
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "all";

  let dbQuery = supabase
    .from("offers")
    .select(`
      *,
      product:products!offers_product_id_fkey(id, title, image, price, status, seller),
      from_user:profiles!offers_from_user_id_fkey(id, username, name, avatar, rating, sales),
      to_user:profiles!offers_to_user_id_fkey(id, username, name, avatar, rating, sales)
    `);

  if (type === "received") {
    dbQuery = dbQuery.eq("to_user_id", user.id);
  } else if (type === "sent") {
    dbQuery = dbQuery.eq("from_user_id", user.id);
  } else {
    dbQuery = dbQuery.or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`);
  }

  const { data, error: dbError } = await dbQuery.order("created_at", { ascending: false }).limit(100);

  if (dbError) {
    console.warn("[Offers API] GET error:", dbError.message);
    return NextResponse.json({ offers: [] }, { status: 500 });
  }

  const offers = (data || []).map((o) => ({
    ...o,
    direction: o.from_user_id === user.id ? "sent" : "received",
  }));

  return NextResponse.json({ offers });
}

export async function POST(req) {
  const { user, error } = await verifyAuth(req);
  if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { productId, amount, message } = body;

  if (!productId || !amount) {
    return NextResponse.json({ error: "productId y amount son obligatorios" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);

  // Use RPC: server validates product, seller, price, self-offer, creates notification
  const { data, error: rpcError } = await supabase.rpc("create_offer", {
    p_product_id: productId,
    p_amount: amount,
    p_message: message || "",
  });

  if (rpcError) {
    console.warn("[Offers API] create_offer error:", rpcError.message);
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, offer: data });
}
