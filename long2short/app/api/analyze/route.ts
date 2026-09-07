import { NextRequest, NextResponse } from "next/server";
import { fetchVideoIntel } from "../../../lib/apify";
import { analyzeAnyUrl, isYouTubeUrl } from "../../../lib/anywhere";
import type { VideoIntel } from "../../../lib/types";

// Metadata + transcript only (fast). The heavy video-file download happens
// lazily in /api/render right before Remotion needs the pixels — this keeps
// analyze inside serverless timeouts (Vercel caps at 60s on Hobby).
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string = body.url ?? body.youtubeUrl;
    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    let intel: VideoIntel;
    if (!isYouTubeUrl(url)) {
      // ANY platform (TikTok, Instagram, Facebook, X, Vimeo, direct mp4, …):
      // yt-dlp metadata probe + caption harvest. No download, no Apify.
      const info = await analyzeAnyUrl(url);
      intel = {
        sourceUrl: url,
        title: info.title ?? "Untitled",
        durationSec: info.durationSec ?? 0,
        videoFilePath: "",
        transcript: info.transcript,
      };
    } else {
      // YouTube path: Apify gives rich metadata + transcript.
      intel = await fetchVideoIntel(url);
    }

    return NextResponse.json({
      intel,
      // The actual video FILE is fetched at render time (cached, so it's
      // downloaded exactly once per video).
      videoFilePending: !intel.videoFilePath,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Analyze failed" }, { status: 500 });
  }
}
