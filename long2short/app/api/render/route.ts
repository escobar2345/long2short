import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { EditPlan } from "../../../lib/types";

// Rendering is CPU/IO heavy — run this on the Node runtime, not the edge.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { editPlan, clipIndex, sourceUrl } = (await req.json()) as {
      editPlan: EditPlan;
      clipIndex: number;
      sourceUrl?: string;
    };

    if (!editPlan?.clips?.[clipIndex]) {
      return NextResponse.json({ error: "Invalid editPlan or clipIndex" }, { status: 400 });
    }

    const clip = editPlan.clips[clipIndex];

    const bundled = await bundle({
      entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
    });

    const inputProps = { editPlan, clipIndex };

    const composition = await selectComposition({
      serveUrl: bundled,
      id: "ShortClip",
      inputProps,
    });

    const outDir = path.join(process.cwd(), "public", "renders");
    fs.mkdirSync(outDir, { recursive: true });
    const clipId = editPlan.clips[clipIndex].clipId || `clip-${clipIndex}`;
    const outputLocation = path.join(outDir, `${clipId}.mp4`);

    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    // Record provenance so the UI's "already rendered" gallery + hydration can
    // prove WHICH video a file came from (prevents posting a stale clip from
    // a different source video).
    const manifestPath = path.join(outDir, "manifest.json");
    let manifest: { renders: any[] } = { renders: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (Array.isArray(parsed.renders)) manifest = parsed;
    } catch {
      /* first render */
    }
    const fileName = `${clipId}.mp4`;
    const renders = manifest.renders.filter((r) => r.file !== fileName);
    renders.push({
      file: fileName,
      sourceUrl: sourceUrl ?? "",
      sourceStartSec: clip.sourceStartSec,
      sourceEndSec: clip.sourceEndSec,
      hookTitle: clip.hookTitle ?? "",
      renderedAt: new Date().toISOString(),
    });
    fs.writeFileSync(manifestPath, JSON.stringify({ renders }, null, 2));

    return NextResponse.json({ url: `/renders/${clipId}.mp4` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Render failed" }, { status: 500 });
  }
}
