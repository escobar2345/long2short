import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
// Reads public/renders live — never serve a cached/prerendered copy.
export const dynamic = "force-dynamic";

type ManifestEntry = {
  file: string;
  sourceUrl?: string;
  sourceStartSec?: number;
  sourceEndSec?: number;
  hookTitle?: string;
  renderedAt?: string;
};

/**
 * Lists clips already rendered to public/renders (with provenance from
 * manifest.json, written by /api/render) so the UI can show preview players
 * WITHOUT re-running the expensive Remotion render. Purely read-only —
 * nothing here touches Buffer.
 */
export async function GET() {
  const dir = path.join(process.cwd(), "public", "renders");

  let manifestEntries: ManifestEntry[] = [];
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
    );
    if (Array.isArray(parsed.renders)) manifestEntries = parsed.renders;
  } catch {
    /* no manifest yet — fall back to bare listing */
  }
  const byFile = new Map(manifestEntries.map((m) => [m.file, m]));

  let renders: Record<string, any>[] = [];
  try {
    renders = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".mp4"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        const meta = byFile.get(f);
        return {
          file: f,
          url: `/renders/${f}`,
          sizeMb: +(st.size / 1024 / 1024).toFixed(1),
          modified: st.mtime.toISOString(),
          sourceUrl: meta?.sourceUrl ?? null,
          sourceStartSec: meta?.sourceStartSec ?? null,
          sourceEndSec: meta?.sourceEndSec ?? null,
          hookTitle: meta?.hookTitle ?? null,
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    /* renders dir doesn't exist yet */
  }

  return NextResponse.json({ renders });
}