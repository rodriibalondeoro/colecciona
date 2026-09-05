import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setOtp } from "@/lib/otpStore";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = await rateLimit(`sms:${ip}`, { limit: 3, windowMs: 60000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiados intentos. Espera un momento." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const { phone, email } = body;

    // Clave del OTP: teléfono (normalizado) o email si no hay teléfono.
    let otpKey = phone ? normalizePhone(phone) : null;
    let targetPhone = otpKey;

    if (!otpKey && email) {
      // Login por email: intentamos resolver el teléfono de la cuenta
      if (url && key) {
        const supabase = createClient(url, key);
        const { data } = await supabase.from("user_private").select("phone, email").eq("email", email).maybeSingle();
        if (data?.phone) {
          otpKey = data.phone;
          targetPhone = data.phone;
        } else {
          otpKey = email;
        }
      } else {
        otpKey = email;
      }
    }

    if (!otpKey) {
      return NextResponse.json({ error: "Número de teléfono obligatorio" }, { status: 400 });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    setOtp(otpKey, code);

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (twilioSid && twilioAuthToken && twilioPhone && targetPhone) {
      try {
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString("base64")}`,
            },
            body: new URLSearchParams({
              To: targetPhone,
              From: twilioPhone,
              Body: `Tu código de verificación de Colecciona es: ${code}. Válido durante 5 minutos.`,
            }),
          }
        );
        if (!twilioRes.ok) {
          console.error(`[SMS Send] Twilio respondió ${twilioRes.status}: ${await twilioRes.text()}`);
          return NextResponse.json({ error: "Error al enviar el SMS" }, { status: 502 });
        }
      } catch (err) {
        console.error("[SMS Send] Error de red con Twilio:", err.message);
        return NextResponse.json({ error: "Error al enviar el SMS" }, { status: 502 });
      }
      return NextResponse.json({
        success: true,
        message: "Código SMS enviado con éxito",
        otpKey,
      });
    }

    console.log(`📱 [Colecciona SMS Mock] Código enviado a ${otpKey}: ${code} (Expira en 5 min)`);
    return NextResponse.json({
      success: true,
      message: "Código SMS enviado con éxito",
      otpKey,
      demoCode: code, // En modo demo (sin Twilio) se devuelve para poder probar el flujo
    });
  } catch (error) {
    console.error("Error en SMS Send API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
