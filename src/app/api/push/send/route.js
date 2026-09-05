import { NextResponse } from "next/server";

// PUSH-IDOR-01: Client-accessible push send removed.
// Push notifications are sent exclusively through backend notification
// flows (follow, message, etc.) which determine the recipient from
// trusted backend context, not from client-provided recipientId.
//
// Any previous callers should use the Supabase notification table +
// service_role client pattern instead of this endpoint.
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint has been removed. Push notifications are sent server-side only." },
    { status: 410 }
  );
}
