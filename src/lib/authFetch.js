import { supabase } from "./supabase";

let redirecting = false;

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Client-side auth helper for fetch calls.
 * Returns headers with Bearer token from Supabase Auth (or localStorage fallback).
 * Automatically redirects to /auth on 401 responses.
 * Adds AbortController timeout to prevent infinite hangs.
 */
export async function authFetch(url, options = {}) {
  let token = null;

  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    } catch (e) {
      console.warn("[authFetch] Supabase session error:", e?.message);
    }
  } else {
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

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
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[authFetch] Request timed out:", url);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
