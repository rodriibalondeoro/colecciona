import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";
import { verifyAuth } from "@/lib/serverAuth";

export async function GET(req) {
  try {
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ alerts: [] });

    const { user } = await verifyAuth(req);
    if (!user) {
      return NextResponse.json({ alerts: [] });
    }

    const { data: alerts } = await supabase
      .from("price_alerts")
      .select(`
        id, target_price, active, triggered, created_at,
        product:products(id, title, price, image, category)
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ alerts: alerts || [] });
  } catch (err) {
    console.error("[Price Alerts GET Error]", err);
    return NextResponse.json({ alerts: [] });
  }
}

export async function POST(req) {
  try {
    const { productId, targetPrice } = await req.json();

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const { user } = await verifyAuth(req);
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Verificar premium
    const { data: profile } = await supabase
      .from("users").select("is_premium").eq("id", user.id).single();

    if (!profile?.is_premium) {
      return NextResponse.json({ error: "Función exclusiva de Premium" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("price_alerts")
      .upsert(
        { user_id: user.id, product_id: productId, target_price: targetPrice, active: true },
        { onConflict: "user_id,product_id" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ alert: data });
  } catch (err) {
    console.error("[Price Alerts POST Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const alertId = searchParams.get("id");

    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

    const { user } = await verifyAuth(req);
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    await supabase
      .from("price_alerts")
      .delete()
      .eq("id", alertId)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Price Alerts DELETE Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
