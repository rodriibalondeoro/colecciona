import { NextResponse } from "next/server";

export async function GET() {
  const twilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
  return NextResponse.json({ twilio });
}
