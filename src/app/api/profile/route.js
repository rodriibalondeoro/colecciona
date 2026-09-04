import { NextResponse } from "next/server";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

export async function GET(req) {
  const { user, error: authError } = await verifyAuth(req);
  if (!user) {
    return NextResponse.json({ error: authError || "No autenticado", profile: null }, { status: 401 });
  }

  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "No autenticado", profile: null }, { status: 401 });
  }

  // Use authenticated client — RLS enforced (owner-only reads)
  const supabase = createUserClient(token);

  const { data: profile } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();

  const { data: priv } = await supabase
    .from("user_private").select("*").eq("user_id", user.id).maybeSingle();

  const { data: wall } = await supabase
    .from("wallet").select("*").eq("user_id", user.id).maybeSingle();

  if (profile) {
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

  return NextResponse.json({ error: authError || "No autenticado", profile: null }, { status: 401 });
}

export async function PATCH(req) {
  const { user, error: authError } = await verifyAuth(req);
  if (!user) {
    return NextResponse.json({ error: authError || "No autenticado", profile: null }, { status: 401 });
  }

  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "No autenticado", profile: null }, { status: 401 });
  }

  // Use authenticated client — RLS enforced (owner-only updates)
  const supabase = createUserClient(token);

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

  // Apply profile updates
  let data = null;

  if (Object.keys(profileUpdates).length > 0) {
    const { data: updated, error: e1 } = await supabase
      .from("profiles").update(profileUpdates).eq("id", user.id).select().single();
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    data = updated;
  }

  // Apply private updates — CHECK ERROR
  if (Object.keys(privateUpdates).length > 0) {
    const { error: privError } = await supabase
      .from("user_private").update(privateUpdates).eq("user_id", user.id);
    if (privError) {
      console.error("[Profile] user_private update error:", privError.message);
      return NextResponse.json({ error: "Error guardando datos privados" }, { status: 500 });
    }
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
