import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    // Validate UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    if (!url || !anonKey) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }

    // Public product: use anon key (RLS allows public SELECT on ACTIVE products)
    const supabase = createClient(url, anonKey);

    const { data, error } = await supabase
      .from("products")
      .select(`
        *,
        seller:profiles!products_seller_fkey(id, username, name, avatar, rating, sales, location)
      `)
      .eq("id", id)
      .eq("status", "ACTIVE")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true, product: data });
  } catch (error) {
    console.error("[Product Detail] Error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
