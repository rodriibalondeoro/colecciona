import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  if (!url || !serviceKey) {
    return NextResponse.json({ profile: null }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);

  const { user, error: authError } = await verifyAuth(req);
  if (user) {
    const { data } = await supabase.from("users").select("*").eq("id", user.id).single();
    if (data) return NextResponse.json({ profile: data });
  }

  return NextResponse.json({ error: authError || "No autenticado", profile: null }, { status: 401 });
}

export async function PATCH(req) {
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);

  const { user, error: authError } = await verifyAuth(req);
  if (!user) {
    return NextResponse.json({ error: authError || "No autenticado" }, { status: 401 });
  }

  const body = await req.json();
  const updates = {};
  if (body.name) updates.name = body.name;
  if (body.username !== undefined) updates.username = String(body.username || "").replace("@", "");
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.location !== undefined) updates.location = body.location;
  if (body.avatar_url !== undefined) updates.avatar = body.avatar_url;
  if (body.seller_shipping_methods !== undefined) {
    const allowed = new Set(["sm1", "sm2", "sm3"]);
    const selected = Array.isArray(body.seller_shipping_methods)
      ? body.seller_shipping_methods.filter((id) => allowed.has(id))
      : [];
    updates.seller_shipping_methods = selected.length ? selected : ["sm1"];
  }

  // Dirección (obligatoria para vender)
  const addressFields = ["address_street", "address_city", "address_zip", "address_country"];
  let addressChanged = false;
  for (const f of addressFields) {
    if (body[f] !== undefined) {
      updates[f] = String(body[f] || "").trim();
      addressChanged = true;
    }
  }
  if (addressChanged) {
    updates.address_complete = Boolean(
      updates.address_street && updates.address_city && updates.address_zip && updates.address_country
    );
  }

  const { data, error: updateError } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
