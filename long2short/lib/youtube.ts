import { ApifyClient } from "apify-client";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { withRetry } from "./retry";

const execFileAsync = promisify(execFile);

/** Pulls a YouTube video id out of any common URL shape. */
export function extractVideoId(url: string): string {
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    url.match(/shorts\/([A-Za-z0-9_-]{6,})/) ||
    url.match(/embed\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : `video-${Date.now()}`;
}

/** Absolute localhost URL the headless Chromium can fetch during rendering. */
export function localFileUrl(relPath: string): string {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}${relPath}`;
}

/**
 * Makes sure a real mp4 for this YouTube URL exists locally (public/uploads)
 * and returns its absolute local URL for Remotion's OffthreadVideo.
 *
 * Order: local cache -> yt-dlp (free, but YouTube bot-blocks residential IPs;
 * this machine is currently blocked) -> convertfleetdotonline~youtube-downloader
 * Apify actor (verified live 2026-09-03: input { "videoUrls": ["<url>"],
 * "quality": "720" } returns dataset items with signed direct CDN URLs, e.g.
 * highest_quality_url) -> truefetch~youtube-video-downloader (input
 * { "video_url": ..., "video_quality": "high"|"medium"|"low"|"metadata" },
 * stores the mp4 on Apify storage and returns its URL in the `video` field).
 */
export async function ensureVideoFile(youtubeUrl: string): Promise<string> {
  const id = extractVideoId(youtubeUrl);
  const upDir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(upDir, { recursive: true });
  const finalPath = path.join(upDir, `${id}.mp4`);
  const relPath = `/uploads/${id}.mp4`;

  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 100_000) {
    return localFileUrl(relPath);
  }

  // 1) yt-dlp (free). Cap at 720p — Remotion outputs 1080x1920 portrait, so
  // 720p source is plenty and downloads ~3x faster.
  try {
    await execFileAsync(
      "yt-dlp",
      [
        "--no-playlist",
        "-f", "bv*[height<=720]+ba/b[height<=720]/b",
        "--merge-output-format", "mp4",
        "--no-part",
        "-o", path.join(upDir, `${id}.%(ext)s`),
        youtubeUrl,
      ],
      { timeout: 240_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
    );
    remuxIfNeeded(upDir, id);
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 100_000) {
      return localFileUrl(relPath);
    }
  } catch {
    // bot-check / 429 — fall through to the Apify actor
  }

  // 2) Apify downloader actor
  await downloadViaApify(youtubeUrl, finalPath);
  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 100_000) {
    throw new Error("downloader produced no usable file");
  }
  return localFileUrl(relPath);
}

/** If yt-dlp produced .webm/.mkv etc, remux into mp4 (ffmpeg stream copy).
 *  Deliberately ignores subtitle files (slug.en.vtt) and fragments. */
export function remuxIfNeeded(dir: string, id: string): boolean {
  const VIDEO_EXT = /\.(webm|mkv|mov|avi|flv|m4v|ts)$/i;
  const candidates = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        f.startsWith(id + ".") &&
        !f.endsWith(".mp4") &&
        !f.endsWith(".part") &&
        VIDEO_EXT.test(f)
    );
  if (!candidates.length) return fs.existsSync(path.join(dir, id + ".mp4"));
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-i", path.join(dir, candidates[0]), "-c", "copy", path.join(dir, id + ".mp4")],
      { windowsHide: true, timeout: 120_000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the configured Apify downloader actor and streams the returned file to
 * destPath. Default actor: boztek-ltd~youtube-downloader — input/output shape
 * verified verbatim from its Apify Store README (2026-09-03):
 *   input  { startUrls: [{ url }], downloadType: "video", quality: "720p" }
 *   output dataset item { sourceUrl, downloadUrl, status }  — status one of
 *   SUCCESS | FAILED (YouTube blocked every attempt) | SKIPPED (spend limit).
 * It routes each attempt through its own residential exit IP specifically to
 * dodge YouTube's bot check (which blocks plain yt-dlp, locally AND on Apify).
 */
async function downloadViaApify(youtubeUrl: string, destPath: string): Promise<void> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN is not set — cannot run the Apify video-downloader fallback");
  }
  const client = new ApifyClient({ token });

  const urlFields = [
    "highest_quality_url",
    "bestCombinedUrl",
    "best_combined_url",
    "downloadUrl",
    "videoUrl",
    "fileUrl",
    "video",
    "url",
  ];
  const pickUrl = (items: Record<string, any>[]): string => {
    for (const it of items) {
      for (const f of urlFields) {
        const u = it?.[f];
        if (typeof u === "string" && /^https?:\/\//.test(u)) return u;
      }
    }
    // last resort: regex-scan the whole payload for a media link
    for (const it of items) {
      const m = JSON.stringify(it).match(
        /https?:\/\/[^\s"']+(?:googlevideo|googleusercontent|\.mp4|\.webm|\.mkv)[^\s"']*/i
      );
      if (m) return m[0];
    }
    return "";
  };

  let dlUrl = "";
  try {
    const run = await withRetry(
      () =>
        client
          .actor(
            process.env.APIFY_VIDEO_DOWNLOADER_ACTOR_ID ||
              "convertfleetdotonline~youtube-downloader"
          )
          .call({ videoUrls: [youtubeUrl], quality: "720" }),
      2
    );
    const { items } = await withRetry(
      () => client.dataset(run.defaultDatasetId).listItems(),
      2
    );
    dlUrl = pickUrl(items as Record<string, any>[]);
  } catch {
    // try the second actor
  }

  if (!dlUrl) {
    const run = await withRetry(
      () =>
        client
          .actor("truefetch~youtube-video-downloader")
          .call({ video_url: youtubeUrl, video_quality: "high" }),
      2
    );
    const { items } = await withRetry(
      () => client.dataset(run.defaultDatasetId).listItems(),
      2
    );
    dlUrl = pickUrl(items as Record<string, any>[]);
  }
  if (!dlUrl) throw new Error("no Apify downloader could return a video URL");

  const res = await withRetry(() => fetch(dlUrl), 3);
  if (!res.ok || !res.body) {
    throw new Error(`video file download failed: HTTP ${res.status}`);
  }
  const tmp = path.join(os.tmpdir(), `${Date.now()}-dl.mp4`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
  fs.renameSync(tmp, destPath);
}