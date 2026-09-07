// File-backed store for MULTIPLE Buffer accounts.
//
// Each account = one Buffer personal API key (+ its organization ID). The UI
// lets you add/remove as many as you want; every posting/analytics operation
// can then run against any subset of them SIMULTANEOUSLY (see
// app/api/buffer/post/route.ts which fans out across accounts in parallel).
//
// Storage is a plain JSON file under data/ (gitignored) — deliberately not a
// database since this project has no DB dependency and this is a local tool.
//
// SECURITY: access tokens are server-side only. The client never receives a
// full token — publicAccount() masks it before it leaves the server.

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { listChannels, listOrganizations } from "./buffer";

export interface BufferAccount {
  id: string;
  name: string;
  accessToken: string;
  organizationId: string;
  addedAt: string; // ISO timestamp
}

const DATA_DIR = path.join(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readAll(): Promise<BufferAccount[]> {
  try {
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    // First run or unreadable file — start empty.
    return [];
  }
}

async function writeAll(accounts: BufferAccount[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(ACCOUNTS_FILE, JSON.stringify({ accounts }, null, 2), "utf-8");
}

/**
 * All saved accounts. If none are saved yet but the legacy single-account env
 * vars exist, they surface as a synthetic "Default" account so existing setups
 * keep working unchanged until you add accounts through the UI.
 */
export async function listAccounts(): Promise<BufferAccount[]> {
  const saved = await readAll();
  if (saved.length === 0 && process.env.BUFFER_ACCESS_TOKEN) {
    return [
      {
        id: "default-env",
        name: "Default (from .env.local)",
        accessToken: process.env.BUFFER_ACCESS_TOKEN,
        organizationId: process.env.BUFFER_ORGANIZATION_ID ?? "",
        addedAt: new Date().toISOString(),
      },
    ];
  }
  return saved;
}

/** Full account (with real token) for server-side use only. */
export async function getAccount(id: string): Promise<BufferAccount | null> {
  const all = await listAccounts();
  return all.find((a) => a.id === id) ?? null;
}

export async function addAccount(input: {
  name: string;
  accessToken: string;
  organizationId?: string;
}): Promise<BufferAccount> {
  const name = input.name?.trim();
  const accessToken = input.accessToken?.trim();
  if (!name || !accessToken) {
    throw new Error("Both a display name and an access token are required");
  }

  const all = await readAll();
  if (all.some((a) => a.accessToken === accessToken)) {
    throw new Error("This access token is already saved as an account");
  }

  // Resolve the Buffer organization from just the token (Buffer's root
  // `account` query returns the orgs a key can reach — the GraphQL successor
  // to REST /user.json), so users don't have to hunt for a 24-char org ID in
  // Buffer's UI. Hand-typed IDs always win; the field is only required when
  // auto-detection can't figure the org out.
  let organizationId = input.organizationId?.trim() ?? "";
  if (!organizationId) {
    let orgs: Awaited<ReturnType<typeof listOrganizations>>;
    try {
      orgs = await listOrganizations(accessToken);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/UNAUTHENTICATED|HTTP 401|HTTP 403/i.test(msg)) {
        throw new Error(
          "Buffer rejected this token as invalid (UNAUTHENTICATED). Generate a " +
            "fresh personal API key at buffer.com → Settings → API and try again."
        );
      }
      // Network/DNS blip — the token itself may be perfectly fine. Say so
      // instead of the old misleading "invalid token" message.
      throw new Error(
        `Couldn't reach Buffer to auto-detect the organization (${msg}). Your ` +
          "connection/DNS may have blipped — try again in a few seconds, or " +
          "paste the Organization ID manually."
      );
    }
    if (orgs.length === 1) {
      organizationId = orgs[0].id;
    } else if (orgs.length > 1) {
      throw new Error(
        `This token reaches multiple Buffer organizations: ${orgs
          .map((o) => `${o.name ? `${o.name} ` : ""}${o.id}`)
          .join(", ")}. Enter the Organization ID you want this account to use.`
      );
    } else {
      throw new Error(
        "Buffer accepted this token, but no organizations are attached to it. " +
          "Paste the Organization ID manually (it appears in your Buffer " +
          "dashboard URL), or use a token from an account that owns channels."
      );
    }
  }

  // Prove the credentials work against Buffer NOW so broken tokens or a wrong
  // org ID fail with a real reason at add-time instead of mysterious
  // channel-loading errors later.
  try {
    await listChannels(accessToken, organizationId);
  } catch (err: any) {
    throw new Error(
      `Buffer rejected these credentials: ${err.message ?? "unknown error"}. ` +
        "Check the token (buffer.com → Settings → API) and the Organization ID."
    );
  }

  const account: BufferAccount = {
    id: crypto.randomUUID(),
    name,
    accessToken,
    organizationId,
    addedAt: new Date().toISOString(),
  };
  all.push(account);
  await writeAll(all);
  return account;
}

export async function removeAccount(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((a) => a.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

/** Client-safe shape — token masked, never the real value. */
export function publicAccount(account: BufferAccount) {
  const token = account.accessToken ?? "";
  const tail = token.slice(-4);
  return {
    id: account.id,
    name: account.name,
    organizationId: account.organizationId,
    addedAt: account.addedAt,
    tokenMask: `${"•".repeat(Math.max(token.length - 4, 0))}${tail}`,
  };
}
