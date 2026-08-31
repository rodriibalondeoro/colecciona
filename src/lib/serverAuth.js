import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
