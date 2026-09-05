// Distributed rate limiter using Supabase (shared across instances)
// Falls back to in-memory if Supabase is not available

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fallback in-memory for when Supabase is unavailable
const fallbackHits = new Map();

export async function rateLimit(key, { limit = 30, windowMs = 60000 } = {}) {
  // Try Supabase-backed rate limiting (distributed)
  if (url && serviceKey) {
    try {
      const supabase = createClient(url, serviceKey);
      const { data, error } = await supabase.rpc("check_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_ms: windowMs,
      });

      if (!error && data) {
        return {
          allowed: data.allowed,
          remaining: data.remaining,
          resetAt: new Date(data.reset_at).getTime(),
        };
      }
    } catch (err) {
      console.warn("[RateLimit] Supabase fallback:", err.message);
    }
  }

  // Fallback: in-memory (single instance only)
  const now = Date.now();
  const record = fallbackHits.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  record.count++;
  fallbackHits.set(key, record);

  return {
    allowed: record.count <= limit,
    remaining: Math.max(0, limit - record.count),
    resetAt: record.resetAt,
  };
}
