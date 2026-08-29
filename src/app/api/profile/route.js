import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req) {
  const supabase = createClient(url, serviceKey);

  const { user } = await verifyAuth(req);
  if (user) {
    const { data } = await supabase.from("users").select("*").eq("id", user.id).single();
    if (data) return NextResponse.json({ profile: data });
  }

  const email = req.headers.get("x-user-email");
  if (email) {
    const { data } = await supabase.from("users").select("*").eq("email", email).limit(1).single();
    if (data) return NextResponse.json({ profile: data });
  }

  return NextResponse.json({ profile: null });
}

export async function PATCH(req) {
  const supabase = createClient(url, serviceKey);

  let userId = null;
  const { user } = await verifyAuth(req);
  if (user) {
    userId = user.id;
  } else {
    const email = req.headers.get("x-user-email");
    if (email) {
      const { data } = await supabase.from("users").select("id").eq("email", email).limit(1).single();
      if (data) userId = data.id;
    }
  }
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const updates = {};
  if (body.name) updates.name = body.name;
  if (body.username !== undefined) updates.username = String(body.username || "").replace("@", "");
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.location !== undefined) updates.location = body.location;
  if (body.avatar_url !== undefined) updates.avatar = body.avatar_url;

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
    .eq("id", userId)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
