// Supabase Client
// Error in production runtime if not configured; warning in dev/build
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let supabaseClient = null;
let isRealSupabase = false;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    isRealSupabase = true;
    console.log("🌲 [Colecciona] Supabase conectado.");
  } catch (error) {
    console.error("❌ [Colecciona] Error inicializando Supabase:", error);
  }
} else {
  console.warn(
    "⚠️ [Colecciona] Supabase no configurado. Modo demo/local."
  );
}

export const supabase = supabaseClient;
export const isConfigured = isRealSupabase;

/**
 * Throws in production if Supabase is not configured.
 * Call this at the start of API routes that require a real database.
 */
export function requireSupabase() {
  if (!supabaseClient) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "🚨 [Colecciona] Supabase no configurado. " +
        "Configura NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY."
      );
    }
    return null;
  }
  return supabaseClient;
}

// Realtime subscription helpers
export function subscribeToMessages(userId, callback) {
  if (!supabaseClient) return () => {};
  const channel = supabaseClient
    .channel("messages-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` }, (payload) => {
      callback(payload.new);
    })
    .subscribe();
  return () => supabaseClient.removeChannel(channel);
}

export function subscribeToNotifications(userId, callback) {
  if (!supabaseClient) return () => {};
  const channel = supabaseClient
    .channel("notifications-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
      callback(payload.new);
    })
    .subscribe();
  return () => supabaseClient.removeChannel(channel);
}
