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
    // Read public profile
    const { data: profile } = await supabase
      .from("profiles").select("*").eq("id", user.id).single();

    // Read private data
    const { data: priv } = await supabase
      .from("user_private").select("*").eq("user_id", user.id).maybeSingle();

    // Read wallet
    const { data: wall } = await supabase
      .from("wallet").select("*").eq("user_id", user.id).maybeSingle();

    if (profile) {
      // Merge for backward compatibility (frontend expects one object)
      return NextResponse.json({
        profile: {
          ...profile,
          email: priv?.email || "",
          phone: priv?.phone || "",
          address_street: priv?.address_street || "",
          address_city: priv?.address_city || "",
          address_zip: priv?.address_zip || "",
          address_country: priv?.address_country || "España",
          address_complete: priv?.address_complete || false,
          seller_shipping_methods: priv?.seller_shipping_methods || ["sm1"],
          balance: wall?.balance || 0,
        },
      });
    }
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

  // Public profile updates
  const profileUpdates = {};
  if (body.name) profileUpdates.name = body.name;
  if (body.username !== undefined) profileUpdates.username = String(body.username || "").replace("@", "");
  if (body.bio !== undefined) profileUpdates.bio = body.bio;
  if (body.location !== undefined) profileUpdates.location = body.location;
  if (body.avatar_url !== undefined) profileUpdates.avatar = body.avatar_url;

  // Private data updates
  const privateUpdates = {};
  if (body.seller_shipping_methods !== undefined) {
    const allowed = new Set(["sm1", "sm2", "sm3"]);
    const selected = Array.isArray(body.seller_shipping_methods)
      ? body.seller_shipping_methods.filter((id) => allowed.has(id))
      : [];
    privateUpdates.seller_shipping_methods = selected.length ? selected : ["sm1"];
  }

  const addressFields = ["address_street", "address_city", "address_zip", "address_country"];
  let addressChanged = false;
  for (const f of addressFields) {
    if (body[f] !== undefined) {
      privateUpdates[f] = String(body[f] || "").trim();
      addressChanged = true;
    }
  }
  if (addressChanged) {
    privateUpdates.address_complete = Boolean(
      (privateUpdates.address_street || body.address_street) &&
      (privateUpdates.address_city || body.address_city) &&
      (privateUpdates.address_zip || body.address_zip) &&
      (privateUpdates.address_country || body.address_country)
    );
  }

  // Apply updates
  let data = null;

  if (Object.keys(profileUpdates).length > 0) {
    const { data: updated, error: e1 } = await supabase
      .from("profiles").update(profileUpdates).eq("id", user.id).select().single();
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    data = updated;
  }

  if (Object.keys(privateUpdates).length > 0) {
    await supabase
      .from("user_private").update(privateUpdates).eq("user_id", user.id);
  }

  // Fetch merged profile for response
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  const { data: priv } = await supabase.from("user_private").select("*").eq("user_id", user.id).maybeSingle();
  const { data: wall } = await supabase.from("wallet").select("*").eq("user_id", user.id).maybeSingle();

  return NextResponse.json({
    profile: {
      ...(profile || data),
      email: priv?.email || "",
      phone: priv?.phone || "",
      address_street: priv?.address_street || "",
      address_city: priv?.address_city || "",
      address_zip: priv?.address_zip || "",
      address_country: priv?.address_country || "España",
      address_complete: priv?.address_complete || false,
      seller_shipping_methods: priv?.seller_shipping_methods || ["sm1"],
      balance: wall?.balance || 0,
    },
  });
}
