// Writable-storage resolver for hosts with a READ-ONLY app directory.
//
// Vercel (and some other serverless platforms) mount the deployment at
// /var/task/... as read-only — the ONLY writable path is /tmp. Writing
// anywhere else throws ENOENT/EROFS from a simple mkdir. Local dev and
// container hosts (Railway, Fly, Docker) can write next to the code.
//
// getStore() picks the right directory once per instance and reports whether
// it's actually persistent, so callers (accounts, prompts) can warn honestly:
// /tmp works but is wiped on every redeploy and instance cold-start.

import fs from "fs";
import os from "os";
import path from "path";

export interface Store {
  /** Directory that is writable on this host. */
  dir: string;
  /** False when we fell back to /tmp (survives only until redeploy/cold start). */
  persistent: boolean;
  /** Human explanation for the UI, or null when storage is plain local disk. */
  note: string | null;
}

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;

  const cwdData = path.join(process.cwd(), "data");
  // Vercel sets VERCEL=1 in the runtime. Skip the cwd attempt there (it's
  // known read-only) but still try it everywhere else — some containers have
  // read-only roots too, and the mkdir below is the real test.
  if (process.env.VERCEL !== "1") {
    try {
      fs.mkdirSync(cwdData, { recursive: true });
      cached = { dir: cwdData, persistent: true, note: null };
      return cached;
    } catch {
      // read-only cwd — fall through to /tmp
    }
  }

  const tmpDir = path.join(os.tmpdir(), "long2short-data");
  fs.mkdirSync(tmpDir, { recursive: true });
  cached = {
    dir: tmpDir,
    persistent: false,
    note:
      "You're on Vercel: the app directory is read-only, so saved accounts and " +
      "prompts are stored in the server instance's /tmp — they work now but are " +
      "wiped on every redeploy or cold start. For a Buffer account that survives, " +
      "set BUFFER_ACCESS_TOKEN (and optionally BUFFER_ORGANIZATION_ID) in " +
      "Vercel → Settings → Environment Variables; it appears automatically as " +
      'the "Default" account.',
  };
  return cached;
}
