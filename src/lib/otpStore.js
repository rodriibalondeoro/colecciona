// Distributed OTP storage backed by Supabase (shared across instances).
// Falls back to an in-memory Map when Supabase is not configured (dev/local),
// so the SMS verification flow works end-to-end in development.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// In-memory fallback (dev only, not shared across instances)
const memoryOtp = new Map();

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
  // Fallback: in-memory (dev/local without Supabase)
  memoryOtp.set(phone, { code, expiresAt: Date.now() + ttlMs, attempts: 0 });
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
  // Fallback: in-memory (dev/local without Supabase)
  const entry = memoryOtp.get(phone);
  if (!entry) return "expired";
  if (Date.now() > entry.expiresAt) {
    memoryOtp.delete(phone);
    return "expired";
  }
  if (entry.attempts >= maxAttempts) {
    memoryOtp.delete(phone);
    return "locked";
  }
  entry.attempts += 1;
  if (String(entry.code) !== String(code).trim()) return "invalid";
  memoryOtp.delete(phone);
  return "success";
}
