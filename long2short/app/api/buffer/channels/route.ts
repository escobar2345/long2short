import { NextResponse } from "next/server";
import { listAccounts, publicAccount } from "../../../../lib/accounts";
import { listChannels } from "../../../../lib/buffer";
import type { BufferChannel } from "../../../../lib/types";

export const runtime = "nodejs";
// Depends on the live accounts file + upstream Buffer calls — always dynamic.
export const dynamic = "force-dynamic";

/**
 * Channels for EVERY saved Buffer account, fetched in parallel. Returns
 * [{ account: {...masked}, channels: [...] }] — one entry per account, so the
 * UI can group multi-account channel pickers and post fan-outs.
 */
export async function GET() {
  let accounts;
  try {
    accounts = await listAccounts();
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to load accounts" }, { status: 500 });
  }

  if (accounts.length === 0) {
    return NextResponse.json({
      accounts: [],
      hint: "No Buffer accounts configured yet — add one in the Accounts panel.",
    });
  }

  const results = await Promise.all(
    accounts.map(async (account) => {
      let channels: BufferChannel[] = [];
      let error: string | undefined;
      try {
        channels = await listChannels(account.accessToken, account.organizationId);
      } catch (err: any) {
        error = err.message ?? "Failed to list channels";
      }
      return { account: publicAccount(account), channels, error };
    })
  );

  return NextResponse.json({ accounts: results });
}
