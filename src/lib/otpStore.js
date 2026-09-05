// Distributed OTP storage backed by Supabase (shared across instances).
// Replaces the in-memory Map (which was per-instance and lost on restart).

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function setOtp(phone, code, ttlMs = 5 * 60 * 1000) {
  if (url && serviceKey) {
    const supabase = createClient(url, serviceKey);
    const { error } = await supabase.rpc("set_otp_code", {
      p_key: phone,
      p_code: code,
      p_ttl_ms: ttlMs,
    });
    if (!error) return;
    console.warn("[OTP] set_otp_code fallback:", error.message);
  }
}

export async function verifyOtp(phone, code, maxAttempts = 5) {
  if (url && serviceKey) {
    const supabase = createClient(url, serviceKey);
    const { data, error } = await supabase.rpc("verify_otp_code", {
      p_key: phone,
      p_code: code,
      p_max_attempts: maxAttempts,
    });
    if (!error) return data; // 'success' | 'invalid' | 'expired' | 'locked'
    console.warn("[OTP] verify_otp_code fallback:", error.message);
  }
  return "expired";
}
