import { NextResponse } from "next/server";
import { getProductById } from "@/data/mockData";
import { getPersistedProducts } from "@/lib/dataService";
import { createClient } from "@supabase/supabase-js";

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && key) {
      const supabase = createClient(url, key);
      const { data, error } = await supabase
        .from("products")
        .select("*, seller:users(*)")
        .eq("id", id)
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
