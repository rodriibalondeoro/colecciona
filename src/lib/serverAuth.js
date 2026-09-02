import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function verifyAuth(req) {
  if (!url || !serviceKey) {
    return { user: null, error: "Supabase no configurado" };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "No autenticado" };
  }
  const token = authHeader.slice(7);
  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: "Token inválido" };
  }
  return { user: data.user, error: null };
}

// Creates a Supabase client with the user's identity (ANON_KEY + user JWT).
// This ensures auth.uid() returns the real user for RLS and SECURITY DEFINER RPCs.
// NEVER use serviceRoleKey here — one client = one identity.
export function createUserClient(token) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Extracts the Bearer token from the request, or returns null.
export function extractToken(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
