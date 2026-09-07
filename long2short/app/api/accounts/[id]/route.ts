import { NextRequest, NextResponse } from "next/server";
import { removeAccount } from "../../../../lib/accounts";

export const runtime = "nodejs";

/** Remove a saved Buffer account by id. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const removed = await removeAccount(params.id);
    if (!removed) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    // The synthetic env-based default can't be deleted from the store.
    if (params.id === "default-env") {
      return NextResponse.json({
        warning:
          "This is the fallback account from .env.local — it will reappear until you set up at least one account in the UI.",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to remove account" }, { status: 500 });
  }
}