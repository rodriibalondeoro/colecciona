import { supabase } from "./supabase";

let redirecting = false;

/**
 * Client-side auth helper for fetch calls.
 * Returns headers with Bearer token from Supabase Auth (or localStorage fallback).
 * Automatically redirects to /auth on 401 responses.
 */
export async function authFetch(url, options = {}) {
  let token = null;

  if (supabase) {
    // Supabase configured → ONLY Supabase Auth
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    } catch (e) {
      console.warn("[authFetch] Supabase session error:", e?.message);
    }
  } else {
    // Demo mode ONLY (Supabase not configured)
    try {
      const raw = localStorage.getItem("colecciona_session");
      if (raw) {
        const s = JSON.parse(raw);
        token = s.access_token || s.accessToken || null;
      }
    } catch {}
  }

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !redirecting) {
    redirecting = true;
    console.warn("[authFetch] 401 received — session expired, redirecting to /auth");
    try {
      if (supabase) await supabase.auth.signOut();
      localStorage.removeItem("colecciona_session");
    } catch {}
    window.location.href = "/auth";
  }

  return res;
}
