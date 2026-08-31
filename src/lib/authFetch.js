/**
 * Client-side auth helper for fetch calls.
 * Returns headers with Bearer token from session.
 */
export async function authFetch(url, options = {}) {
  let token = null;
  try {
    const raw = localStorage.getItem("colecciona_session");
    if (raw) {
      const s = JSON.parse(raw);
      token = s.access_token || s.accessToken || null;
    }
  } catch {}

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Only set Content-Type for non-FormData bodies
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, { ...options, headers });
}
