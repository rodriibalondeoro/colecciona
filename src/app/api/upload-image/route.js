import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { verifyAuth, extractToken, createUserClient } from "@/lib/serverAuth";

const BUCKET = "card-images";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const isDev = process.env.NODE_ENV !== "production";
    if (!isDev) {
      const rl = await rateLimit(`upload:${ip}`, { limit: 5, windowMs: 60000 });
      if (!rl.allowed) {
        return NextResponse.json({ error: "Demasiadas peticiones. Espera un momento." }, { status: 429 });
      }
    }

    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 401 });
    }

    const token = extractToken(req);
    if (!token) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    // Use user client — storage RLS verifies owner = auth.uid()
    const supabase = createUserClient(token);

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ error: "No se ha subido ningún archivo" }, { status: 400 });
    }

    const ext = ALLOWED_IMAGE_TYPES.get(file.type);
    if (!ext) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 415 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "La imagen supera el tamaño máximo de 5 MB" }, { status: 413 });
    }

    const path = `${user.id}/cards/${crypto.randomUUID()}.${ext}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: false });

    if (error) {
      console.error("[API /upload-image] Storage error:", error.message);
      return NextResponse.json({ error: "Error al subir la imagen" }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(data.path);

    return NextResponse.json({ success: true, url: pub.publicUrl });
  } catch (err) {
    console.error("[API /upload-image] Error interno:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
