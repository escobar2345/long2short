import { ApifyClient } from "apify-client";
import { withRetry } from "./retry";
import { extractTranscript } from "./subtitles";
import type { VideoIntel } from "./types";

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

export interface ResearchSource {
  title: string;
  description: string;
  url: string;
}

/** Default SERP actor; override with APIFY_SEARCH_ACTOR_ID in .env.local. */
const DEFAULT_SEARCH_ACTOR = "apify/google-search-scraper";

function searchActorId(): string {
  return process.env.APIFY_SEARCH_ACTOR_ID || DEFAULT_SEARCH_ACTOR;
}

function buildQueries(topic: string): string[] {
  const t = topic.trim();
  return [
    `${t} viral short form video hooks examples`,
    `${t} trending hashtags tiktok instagram reels`,
    `${t} content ideas audience growth tips`,
  ];
}

/** Converts "HH:MM:SS" or "MM:SS" (maybe with .ms) into a seconds number. */
export function parseDurationToSec(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const parts = raw.trim().split(":").map((p) => parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return Number.isFinite(sec) ? sec : 0;
}

/**
 * Searches the live internet through an Apify SERP actor to see what is
 * actually ranking/trending around the user's topic right now. Uses the
 * official apify/google-search-scraper input/output shape:
 *   input  { queries: string[], resultsPerPage, maxPagesPerQuery }
 *   output dataset items { organicResults: [{ title, link, description }] }
 *
 * The GLM coaching step that consumes these results lives in
 * lib/captionCoach.ts.
 */
export async function researchTopic(
  topic: string,
  maxResultsPerQuery = 5
): Promise<ResearchSource[]> {
  const queries = buildQueries(topic);

  let items: Record<string, any>[] = [];
  try {
    const run = await client.actor(searchActorId()).call({
      queries,
      resultsPerPage: maxResultsPerQuery,
      maxPagesPerQuery: 1,
    });
    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    items = dataset.items as Record<string, any>[];
  } catch (err: any) {
    throw new Error(
      `Apify research failed (${err.message ?? err}). Check APIFY_TOKEN and ` +
        `APIFY_SEARCH_ACTOR_ID (currently "${searchActorId()}").`
    );
  }

  const sources: ResearchSource[] = [];
  for (const item of items) {
    const organic: any[] = item.organicResults ?? item.results ?? [];
    for (const r of organic.slice(0, maxResultsPerQuery)) {
      sources.push({
        title: r.title ?? "",
        description: r.description ?? r.snippet ?? "",
        url: r.link ?? r.url ?? "",
      });
    }
  }
  return sources.filter((s) => s.title || s.description).slice(0, 15);
}

/**
 * Runs the configured Apify YouTube scraper (APIFY_YOUTUBE_ACTOR_ID, default
 * streamers~youtube-scraper) and normalizes its output into VideoIntel.
 *
 * Verified live against streamers~youtube-scraper v0.0.289 (2026-09-03): a
 * single-video run returns one dataset item shaped like:
 * {
 *   title, url, id, channelName, duration: "00:10:54",
 *   text: <description>, subtitles: null | [ ...subtitle tracks ]
 * }
 * `duration` is an HH:MM:SS string (hence parseDurationToSec), and
 * `subtitles` is null when the video has no caption track at all (e.g.
 * music-only sports highlight reels) — transcript is then []. Actor calls,
 * dataset reads and any subtitle fetches are wrapped in withRetry because
 * api.apify.com intermittently fails DNS on the user's network.
 */
export async function fetchVideoIntel(youtubeUrl: string): Promise<VideoIntel> {
  const actorId =
    process.env.APIFY_YOUTUBE_ACTOR_ID || "streamers~youtube-scraper";
  if (!process.env.APIFY_TOKEN) {
    throw new Error(
      "APIFY_TOKEN is not set in your environment — create a token at " +
        "console.apify.com → Settings → Integrations"
    );
  }

  const run = await withRetry(
    () =>
      client.actor(actorId).call(
        {
          startUrls: [{ url: youtubeUrl }],
          downloadSubs: true,
          isTranscriptNeeded: true,
          maxItems: 1,
        }
      ),
    3
  );

  const { items } = await withRetry(
    () => client.dataset(run.defaultDatasetId).listItems(),
    3
  );
  const item = items[0] as Record<string, any> | undefined;
  if (!item) {
    throw new Error(
      `The Apify actor "${actorId}" returned no data for this URL — the video ` +
        `may be private, age-restricted or deleted.`
    );
  }

  const durationSec = parseDurationToSec(
    item.duration ?? item.durationSeconds ?? item.durationSec ?? item.lengthSeconds ?? 0
  );

  const transcript = await extractTranscript(item);

  return {
    sourceUrl: youtubeUrl,
    title: item.title ?? "Untitled",
    durationSec,
    // The scraper gives metadata + captions but NOT the video file itself —
    // a real playable file is resolved by ensureVideoFile() in lib/youtube.ts
    // (yt-dlp first, Apify downloader actor as fallback) before rendering.
    videoFilePath: "",
    transcript,
    sceneCuts: item.sceneCuts ?? undefined,
  };
}
