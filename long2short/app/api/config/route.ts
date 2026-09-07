import { NextResponse } from "next/server";
import { getConfigStatus } from "../../../lib/config";

export const runtime = "nodejs";

/** Tells the UI which env vars are set / missing so setup problems are obvious. */
export async function GET() {
  return NextResponse.json({ status: getConfigStatus() });
}