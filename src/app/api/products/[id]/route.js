import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("products")
      .select("*, seller:users(id, username, name, avatar, bio, level, level_name, sales, purchases, rating, location, followers, following, seller_shipping_methods)")
      .eq("id", id)
      .eq("status", "ACTIVE")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true, product: data });
  } catch (error) {
    console.error("Error en Product Detail API:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
