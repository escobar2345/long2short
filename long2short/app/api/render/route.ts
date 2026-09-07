import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ensureVideoFile } from "../../../lib/youtube";
import { ensureVideoFileAnyUrl, isYouTubeUrl } from "../../../lib/anywhere";
import type { EditPlan } from "../../../lib/types";

// Rendering is CPU/IO heavy — run this on the Node runtime, not the edge.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Rendering writes hundreds of MB (source mp4 + output mp4). Serverless
 *  hosts like Vercel have a read-only app directory — fail up front with a
 *  human message instead of ENOENT/EROFS mid-render. */
function assertWritableDisk() {
  const probeDir = path.join(process.cwd(), "public", "renders");
  try {
    fs.mkdirSync(probeDir, { recursive: true });
    const probe = path.join(probeDir, `.write-probe-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch {
    throw new Error(
      "Rendering needs a writable disk for the source + output mp4 files, " +
        "which this host does not provide (Vercel's serverless filesystem is " +
        "read-only). Run this step on your PC or on Railway instead — both work."
    );
  }
}

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

    assertWritableDisk();

    // Analyze is metadata-only (fast), so the actual video FILE is fetched
    // here — lazily, right before Remotion needs pixels. Downloads are cached
    // in public/uploads, so each video is fetched exactly once.
    const plan: EditPlan = { ...editPlan };
    if (!plan.sourceVideoPath) {
      if (!sourceUrl) {
        return NextResponse.json(
          {
            error:
              "No video file for this plan yet and no source URL was provided — " +
              "analyze the video again first.",
          },
          { status: 400 }
        );
      }
      plan.sourceVideoPath = isYouTubeUrl(sourceUrl)
        ? await ensureVideoFile(sourceUrl)
        : (await ensureVideoFileAnyUrl(sourceUrl)).fileUrl;
    }

    const clip = plan.clips[clipIndex];

    const bundled = await bundle({
      entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
    });

    const inputProps = { editPlan: plan, clipIndex };

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
