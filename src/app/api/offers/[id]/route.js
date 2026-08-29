import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "@/lib/serverAuth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function PATCH(req, { params }) {
  try {
    const { user, error } = await verifyAuth(req);
    if (error) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const supabase = createClient(url, key);

    const { data: existing } = await supabase
      .from("offers")
      .select("id, from_user_id, to_user_id, amount")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Oferta no encontrada" }, { status: 404 });
    }

    if (existing.to_user_id !== user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const updates = {};
    if (body.status) updates.status = body.status;
    if (body.counter_amount) updates.amount = body.counter_amount;

    const { data, error: updateError } = await supabase
      .from("offers")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const statusMessages = {
      accepted: "Tu oferta ha sido aceptada",
      rejected: "Tu oferta ha sido rechazada",
      countered: `El vendedor ha enviado una contraoferta de ${body.counter_amount?.toFixed(2)} €`,
    };

    await supabase.from("notifications").insert({
      user_id: existing.from_user_id,
      type: "offer",
      title: "Actualización de oferta",
      body: statusMessages[body.status] || "Oferta actualizada",
      link: `/product/${body.product_id || id}`,
    });

    return NextResponse.json({ success: true, offer: data });
  } catch (err) {
    console.error("Error updating offer:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
