import { NextResponse } from "next/server";
import { getProductById } from "@/data/mockData";
import { getPersistedProducts } from "@/lib/dataService";
import { getServerSupabase } from "@/lib/serverSupabase";

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    const supabase = getServerSupabase();
    if (supabase) {
      const { data, error } = await supabase
        .from("products")
        .select("*, seller:users(id, username, name, avatar, bio, level, level_name, sales, purchases, rating, location, followers, following, seller_shipping_methods)")
        .eq("id", id)
        .eq("status", "ACTIVE")
        .single();

      if (!error && data) {
        return NextResponse.json({ success: true, product: data });
      }
    }

    const mockProduct = getProductById(id);
    if (mockProduct) {
      return NextResponse.json({ success: true, product: mockProduct });
    }

    const persisted = getPersistedProducts().find((p) => p.id === id);
    if (persisted) {
      return NextResponse.json({ success: true, product: persisted });
    }

    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  } catch (error) {
    console.error("Error en Product Detail API:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
