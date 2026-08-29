// Supabase Client with Fail-Safe Mock Fallback
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let supabaseClient = null;
let isRealSupabase = false;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    isRealSupabase = true;
    console.log("🌲 [Colecciona] Supabase conectado con éxito.");
  } catch (error) {
    console.warn("⚠️ [Colecciona] Error inicializando Supabase. Usando fallback de datos locales.", error);
  }
} else {
  console.log("ℹ️ [Colecciona] Variables de entorno de Supabase no configuradas. Iniciado en modo local / demo.");
}

export const supabase = supabaseClient;
export const isConfigured = isRealSupabase;

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
