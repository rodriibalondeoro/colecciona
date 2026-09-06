import { NextResponse } from "next/server";

export async function GET() {
  const checks = { api: "ok" };
  let status = 200;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (url && key) {
      const { error } = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.supabase = error ? "unreachable" : "ok";
      if (error) status = 503;
    } else {
      checks.supabase = "not_configured";
    }
  } catch {
    checks.supabase = "unreachable";
    status = 503;
  }

  return NextResponse.json(
    { status: status === 200 ? "healthy" : "degraded", checks, ts: new Date().toISOString() },
    { status }
  );
}
