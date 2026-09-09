import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setOtp } from "@/lib/otpStore";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rateLimit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    let targetEmail = email ? String(email).trim().toLowerCase() : null;

    // Resolver el email/teléfono de la cuenta si solo nos dan uno de los dos.
    if (url && key && (!targetEmail || !targetPhone)) {
      try {
        const supabase = createClient(url, key);
        if (!targetPhone && targetEmail) {
          // Phone login: resolver email asociado al teléfono
          const { data } = await supabase
            .from("user_private")
            .select("phone, email")
            .eq("phone", normalizePhone(phone))
            .maybeSingle();
          if (data?.email) targetEmail = data.email;
        } else if (!targetEmail && targetPhone) {
          // Solo teléfono, sin email: intentar resolver email de la cuenta
          const { data } = await supabase
            .from("user_private")
            .select("phone, email")
            .eq("phone", normalizePhone(phone))
            .maybeSingle();
          if (data?.email) targetEmail = data.email;
        }
      } catch (e) {
        console.warn("[SMS Send] lookup error:", e.message);
      }
    }

    if (!otpKey && !targetEmail) {
      return NextResponse.json({ error: "Número de teléfono o email obligatorio" }, { status: 400 });
    }
    if (!otpKey) otpKey = targetEmail;

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await setOtp(otpKey, code);

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    // 1) Twilio configurado + tenemos teléfono → SMS real
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
        return NextResponse.json({
          success: true,
          method: "sms",
          message: "Código SMS enviado con éxito",
          otpKey,
        });
      } catch (err) {
        console.error("[SMS Send] Error de red con Twilio:", err.message);
        return NextResponse.json({ error: "Error al enviar el SMS" }, { status: 502 });
      }
    }

    // 2) Sin Twilio pero hay Supabase + email → código OTP por email (Supabase Auth)
    if (!twilioSid && url && anonKey && targetEmail) {
      try {
        const authClient = createClient(url, anonKey);
        const { error: otpErr } = await authClient.auth.signInWithOtp({
          email: targetEmail,
          options: { shouldCreateUser: false },
        });
        if (otpErr) {
          console.error("[SMS Send] Supabase OTP email error:", otpErr.message);
          return NextResponse.json({
            success: false,
            error: "No se pudo enviar el código por email. Inténtalo de nuevo.",
          }, { status: 502 });
        }
        return NextResponse.json({
          success: true,
          method: "email",
          message: "Código de verificación enviado a tu email",
          otpKey: targetEmail,
        });
      } catch (err) {
        console.error("[SMS Send] Error enviando OTP por email:", err.message);
        return NextResponse.json({
          success: false,
          error: "No se pudo enviar el código por email. Inténtalo de nuevo.",
        }, { status: 502 });
      }
    }

    // 3) Sin Twilio y sin email (dev puro): revelar el código en modo demo
    console.log(`📱 [Colecciona OTP Mock] Código ${code} para ${otpKey} (Expira en 5 min)`);
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      return NextResponse.json({
        success: false,
        error: "Servicio de verificación no configurado. Contacta con soporte.",
      }, { status: 503 });
    }
    return NextResponse.json({
      success: true,
      method: "demo",
      message: "Código de verificación generado",
      otpKey,
      demoCode: code,
    });
  } catch (error) {
    console.error("Error en SMS Send API:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
