import { createClient } from "@supabase/supabase-js";

/**
 * Returns Supabase server client or null in dev.
 * Throws in production if not configured.
 */
export function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "🚨 [Colecciona] Configura NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en producción."
      );
    }
    return null;
  }

  try {
    return createClient(url, key);
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Supabase server client failed: ${err.message}`);
    }
    return null;
  }
}
