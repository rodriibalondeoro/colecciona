// Supabase Client
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

// Active channel refs for cleanup
let activeMessageChannel = null;
let activeNotificationChannel = null;

export function subscribeToMessages(userId, callback) {
  if (!supabaseClient || !userId) return () => {};

  // Clean up previous channel for this subscription slot
  if (activeMessageChannel) {
    supabaseClient.removeChannel(activeMessageChannel);
    activeMessageChannel = null;
  }

  const channel = supabaseClient
    .channel(`messages-${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` }, (payload) => {
      callback(payload.new);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[Realtime] Messages channel error, will retry on next subscribe");
      }
    });

  activeMessageChannel = channel;
  return () => {
    supabaseClient.removeChannel(channel);
    if (activeMessageChannel === channel) activeMessageChannel = null;
  };
}

export function subscribeToNotifications(userId, callback) {
  if (!supabaseClient || !userId) return () => {};

  if (activeNotificationChannel) {
    supabaseClient.removeChannel(activeNotificationChannel);
    activeNotificationChannel = null;
  }

  const channel = supabaseClient
    .channel(`notifications-${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
      callback(payload.new);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[Realtime] Notifications channel error, will retry on next subscribe");
      }
    });

  activeNotificationChannel = channel;
  return () => {
    supabaseClient.removeChannel(channel);
    if (activeNotificationChannel === channel) activeNotificationChannel = null;
  };
}
