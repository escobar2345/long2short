import { NextResponse } from "next/server";
import { tunnelStatus } from "../../../lib/tunnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Passive status of the public URL Buffer will fetch videos from. Never
 * spawns ngrok — the tunnel comes online on demand inside /api/buffer/post.
 */
export async function GET() {
  try {
    return NextResponse.json(await tunnelStatus());
  } catch (err: any) {
    return NextResponse.json(
      { mode: "none", url: null, note: err?.message ?? "Tunnel status check failed" },
      { status: 200 }
    );
  }
}