import { NextResponse } from "next/server";

// /api/upload is deprecated — use /api/upload-image instead.
// This endpoint previously returned mock images, which was deceptive.
export async function POST() {
  return NextResponse.json(
    { error: "Use /api/upload-image instead" },
    { status: 410 }
  );
}
