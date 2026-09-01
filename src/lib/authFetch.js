import { supabase } from "./supabase";

/**
 * Client-side auth helper for fetch calls.
 * Returns headers with Bearer token from Supabase Auth (or localStorage fallback).
 */
export async function authFetch(url, options = {}) {
  let token = null;

  // Try Supabase Auth first
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    } catch {}
  }

  // Fallback to localStorage (demo mode)
  if (!token) {
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

  return fetch(url, { ...options, headers });
}
