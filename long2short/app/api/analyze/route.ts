import { NextRequest, NextResponse } from "next/server";
import { fetchVideoIntel } from "../../../lib/apify";
import { ensureVideoFile } from "../../../lib/youtube";
import { ensureVideoFileAnyUrl, isYouTubeUrl } from "../../../lib/anywhere";
import type { VideoIntel } from "../../../lib/types";

// Apify runs + the video download can take minutes on a slow link.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string = body.url ?? body.youtubeUrl;
    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    // ANY platform (TikTok, Instagram, Facebook, X, Vimeo, direct mp4, …):
    // yt-dlp handles 1000+ sites and also harvests caption tracks for the
    // transcript. No Apify needed on this path.
    if (!isYouTubeUrl(url)) {
      const info = await ensureVideoFileAnyUrl(url);
      const intel: VideoIntel = {
        sourceUrl: url,
        title: info.title ?? "Untitled",
        durationSec: info.durationSec ?? 0,
        videoFilePath: info.fileUrl,
        transcript: info.transcript,
      };
      return NextResponse.json({ intel });
    }

    // YouTube path: Apify gives rich metadata + transcript; the video file
    // itself comes from yt-dlp / the Apify downloader fallback.
    const intel = await fetchVideoIntel(url);

    // Remotion cuts real pixels, not text — resolve an actual downloadable
    // video file (yt-dlp first, Apify downloader actor as fallback). If this
    // fails we still hand the metadata back so the UI shows what we DID get.
    if (!intel.videoFilePath) {
      try {
        intel.videoFilePath = await ensureVideoFile(url);
      } catch (err: any) {
        return NextResponse.json(
          {
            error:
              `Metadata came back, but getting the actual video file failed: ` +
              `${err.message ?? err}`,
            intel,
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ intel });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Analyze failed" }, { status: 500 });
  }
}
