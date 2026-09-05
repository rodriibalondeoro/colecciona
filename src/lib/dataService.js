// Data Service — Capa de persistencia con fallback local
// Si Supabase está configurado escribe a través de las API routes del servidor
// (que sí pueden alcanzar Supabase). Si no, usa localStorage.

import { supabase, isConfigured } from "./supabase";

async function getAuthToken() {
  if (supabase) {
    // Supabase configured → ONLY Supabase Auth
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) return data.session.access_token;
    } catch {}
    return null;
  }
  // Demo mode ONLY (Supabase not configured)
  try {
    const raw = localStorage.getItem("colecciona_session");
    if (raw) {
      const s = JSON.parse(raw);
      if (s.access_token) return s.access_token;
    }
  } catch {}
  return null;
}

async function authHeaders() {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DB_KEY = "colecciona_db";
// Si el navegador no puede alcanzar Supabase (red lenta, proxy, bloqueo), estas
// llamadas se quedarían colgadas para siempre. Con un timeout razonable todo cae
// al store local y la app sigue funcionando igual.
const NET_TIMEOUT = 10000;

const emptyDB = () => ({ users: [], products: [], messages: [] });

export function readDB() {
  if (typeof window === "undefined") return emptyDB();
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? { ...emptyDB(), ...JSON.parse(raw) } : emptyDB();
  } catch {
    return emptyDB();
  }
}

export function writeDB(db) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {}
}

/**
 * Registra un usuario. Usa API route (/api/register) para llegar a Supabase.
 * En producción: falla si el servidor no responde (sin fallback local).
 * En modo demo (Supabase no configurado): persiste en localStorage.
 */
export async function registerUser(user) {
  let res;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NET_TIMEOUT);
    res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        phone: user.phone,
        password: user.password,
        fullName: user.fullName,
        username: user.username,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (res.ok && json.user) return json.user;
    throw new Error(json.error || `HTTP ${res.status}`);
  } catch (err) {
    if (res && res.status === 409) {
      throw new Error(err.message);
    }
    // In production: fail hard — no local registration
    if (isConfigured) {
      throw new Error(
        err.name === "AbortError"
          ? "Servidor no disponible. Intenta de nuevo."
          : err.message || "Error al registrar usuario"
      );
    }
    // Demo mode only: persist locally
    console.warn("[DataService] Demo mode: registrando localmente");
  }

  const db = readDB();
  const record = {
    id: `u${Date.now()}`,
    name: user.fullName,
    username: String(user.username || "").replace("@", ""),
    email: user.email,
    phone: user.phone,
    initials: String(user.fullName || "")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    level: 1,
    levelName: "Nuevo Vendedor",
    verified: true,
    sales: 0,
    rating: 5.0,
    memberSince: new Date().getFullYear(),
    location: "España",
    responseTime: "< 1 hora",
    seller_shipping_methods: ["sm1"],
    registeredAt: new Date().toISOString(),
  };
  db.users.push(record);
  writeDB(db);
  return record;
}

/**
 * Publica un producto en el mercado. Usa API route (/api/publish) para
 * llegar a Supabase desde el servidor. Si la API falla, persiste en localStorage.
 */
export async function publishProduct(product) {
  const payload = {
    title: product.title,
    price: product.price,
    image: product.image,
    category: product.category,
    condition: product.condition,
    seller: product.seller,
    sellerName: product.sellerName,
    code: product.code,
    rarity: product.rarity,
    description: product.description,
    set: product.set,
    language: product.language,
    year: product.year,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NET_TIMEOUT);
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (res.ok && json.product) return json.product;
    console.warn("[DataService] publishProduct via API falló:", json.error);
    throw new Error(json.error || `HTTP ${res.status}`);
  } catch (err) {
    console.warn("[DataService] publishProduct via API no disponible:", err?.message);
    throw err;
  }
}

/** Productos publicados localmente (además del catálogo mock). */
export function getPersistedProducts() {
  return readDB().products || [];
}

/** Elimina un producto de Supabase. En producción, falla si el servidor no responde. */
export async function deleteProduct(productId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT);
  try {
    const res = await fetch(`/api/publish/${productId}`, {
      method: "DELETE",
      headers: { ...(await authHeaders()) },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) return true;
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === "AbortError"
      ? "Servidor no disponible. Intenta de nuevo."
      : err.message || "Error al eliminar producto");
  }
}

/** Persiste un mensaje de chat. Returns { messageId, createdAt } on success. */
export async function persistMessage(message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT);
  try {
    const res = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (res.ok) return { messageId: data.messageId, createdAt: data.createdAt };
    throw new Error(data.error || `HTTP ${res.status}`);
  } catch (err) {
    clearTimeout(timer);
    if (isConfigured) {
      throw new Error(
        err.name === "AbortError"
          ? "Servidor no disponible. Mensaje no enviado."
          : err.message || "Error al enviar mensaje"
      );
    }
    // Demo mode only
    console.warn("[DataService] Demo mode: guardando mensaje localmente");
    const db = readDB();
    const localId = `m${Date.now()}`;
    db.messages.push({ ...message, id: localId });
    writeDB(db);
    return { messageId: localId, createdAt: new Date().toISOString() };
  }
}

/** Crea una oferta de precio para un producto (inicia el hilo de negociación). */
export async function createOffer({ productId, amount, message }) {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId, amount, message }),
    });
    const data = await res.json();
    return data.offer || null;
  } catch (err) {
    console.warn("[DataService] createOffer no disponible:", err?.message);
    return null;
  }
}

/** Lista las ofertas del usuario (enviadas y recibidas). */
export async function getOffers() {
  const token = await getAuthToken();
  if (!token) return [];
  try {
    const res = await fetch("/api/offers", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.offers || [];
  } catch (err) { console.error("[DataService] getOffers error:", err?.message); return []; }
}

/** Acepta o rechaza una oferta recibida. */
export async function updateOffer({ id, status }) {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/offers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, status }),
    });
    return res.ok;
  } catch (err) { console.error("[DataService] updateOffer error:", err?.message); return null; }
}

/** Obtiene las reseñas públicas de un usuario (vendedor). */
export async function fetchReviews(userId) {
  if (!userId) return [];
  try {
    const res = await fetch(`/api/reviews?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    return data.reviews || [];
  } catch (err) { console.error("[DataService] fetchReviews error:", err?.message); return []; }
}

export async function getFavorites() {
  try {
    const token = await getAuthToken();
    if (!token) return [];
    const res = await fetch("/api/favorites", { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return data.favorites || [];
  } catch (err) { console.error("[DataService] getFavorites error:", err?.message); return []; }
}

export async function toggleFavoriteAPI(productId) {
  try {
    const token = await getAuthToken();
    if (!token) return null;
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId }),
    });
    const data = await res.json();
    return data.favorited;
  } catch (err) { console.error("[DataService] toggleFavoriteAPI error:", err?.message); return null; }
}

export async function getProfile() {
  try {
    const headers = {};
    const token = await getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!token) return null;
    const res = await fetch("/api/profile", { headers });
    const data = await res.json();
    return data.profile || null;
  } catch (err) { console.error("[DataService] getProfile error:", err?.message); return null; }
}

export async function updateProfile(updates) {
  try {
    const headers = { "Content-Type": "application/json" };
    const token = await getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!token) return null;
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    return data.profile || null;
  } catch (err) { console.error("[DataService] updateProfile error:", err?.message); return null; }
}

/**
 * Reset password via Supabase Auth.
 * Passwords are NEVER stored locally — managed exclusively by Supabase.
 */
export async function resetPassword(email) {
  if (!supabase) throw new Error("Supabase no configurado. No se puede restablecer contraseña.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error(error.message);
  return true;
}

const BUCKET = "card-images";

function dataUrlToBlob(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const byteChars = atob(base64);
  const buf = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) buf[i] = byteChars.charCodeAt(i);
  return new Blob([buf], { type: "image/jpeg" });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Sube la imagen de una carta a Supabase Storage a través de la API route del
 * servidor (/api/upload-image). El servidor sí puede alcanzar Supabase aunque
 * el navegador no. Si la API falla, devuelve un dataURL local persistente.
 * Nunca se queda colgada.
 */
export async function uploadCardImage(input) {
  const localDataUrl =
    typeof input === "string" ? input : await blobToDataUrl(input);

  try {
    const file =
      typeof input === "string"
        ? dataUrlToBlob(input)
        : input;

    const formData = new FormData();
    formData.append("file", file, `card.${file.type === "image/png" ? "png" : "jpg"}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch("/api/upload-image", {
      method: "POST",
      body: formData,
      headers: { ...(await authHeaders()) },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = await res.json();
    if (res.ok && json.url) return json.url;
    console.warn("[DataService] Upload via API falló:", json.error);
  } catch (err) {
    console.warn("[DataService] Upload via API no disponible:", err?.message);
  }

  // Production: never fallback to base64 — image won't persist across devices/browsers
  if (isConfigured) {
    throw new Error("Error al subir la imagen. Inténtalo de nuevo.");
  }

  // Demo mode only: localDataUrl as fallback
  return localDataUrl;
}
