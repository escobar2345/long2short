import { NextRequest, NextResponse } from "next/server";
import {
  addAccount,
  listAccounts,
  publicAccount,
  accountsStorageNote,
} from "../../../lib/accounts";

export const runtime = "nodejs";
// Reads/writes the accounts store — never serve a cached/prerendered copy.
export const dynamic = "force-dynamic";

/** List every saved Buffer account (access tokens masked). */
export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({
      accounts: accounts.map(publicAccount),
      storageNote: accountsStorageNote(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to load accounts" }, { status: 500 });
  }
}

/** Add a new Buffer account — org ID is optional (auto-detected from the token). */
export async function POST(req: NextRequest) {
  try {
    const { name, accessToken, organizationId } = await req.json();
    if (!name?.trim() || !accessToken?.trim()) {
      return NextResponse.json(
        { error: "name and accessToken are required" },
        { status: 400 }
      );
    }
    const account = await addAccount({ name, accessToken, organizationId });
    return NextResponse.json(
      { account: publicAccount(account), storageNote: accountsStorageNote() },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to add account" }, { status: 400 });
  }
}