import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function DELETE(req, { params }) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rl = rateLimit(`publish-delete:${ip}`, { limit: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
    }

    if (!url || !key) {
      return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
    }
    const supabase = createClient(url, key);
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Falta el ID del producto" }, { status: 400 });
    }

    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("seller")
      .eq("id", id)
      .single();

    if (fetchError || !product) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    if (product.seller !== user.id) {
      return NextResponse.json({ error: "No tienes permiso para eliminar este producto" }, { status: 403 });
    }

    const { error } = await supabase.from("products").delete().eq("id", id);

    if (error) {
      console.error("[API /publish DELETE] Error de Supabase:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API /publish DELETE] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
