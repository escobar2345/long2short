import { withRetry } from "./retry";
import type { TranscriptWord } from "./types";

// Subtitle/caption parsing. The streamers~youtube-scraper exposes
// item.subtitles (null when the video has no caption track); other actors use
// transcript/captions keys holding raw SRT/VTT/XML/json3 strings or arrays of
// track objects. extractTranscript() handles every shape we've seen and
// returns [] (never throws) for caption-less videos.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** YouTube timedtext XML: <text start="1.5" dur="2.3">words</text> */
function parseTimedTextXml(raw: string) {
  const cues: { start: number; end: number; text: string }[] = [];
  const re = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = parseFloat(m[1]);
    const dur = parseFloat(m[2]);
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) cues.push({ start, end: start + dur, text });
  }
  return cues;
}

/** SRT / WebVTT block format */
function parseSrtVtt(raw: string) {
  const cues: { start: number; end: number; text: string }[] = [];
  const lines = raw.replace(/\r/g, "").split("\n");
  const tsRe =
    /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
  const toSec = (h: string, m: string, s: string, ms: string) =>
    parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) +
    parseInt(ms.padEnd(3, "0"), 10) / 1000;
  let cur: { start: number; end: number; text: string[] } | null = null;
  for (const line of lines) {
    const m = tsRe.exec(line.trim());
    if (m) {
      if (cur && cur.text.length)
        cues.push({ start: cur.start, end: cur.end, text: cur.text.join(" ").trim() });
      cur = { start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: [] };
      continue;
    }
    const t = line.trim();
    if (cur && t && !/^(WEBVTT|NOTE|Kind:|Language:)/i.test(t) && !/^\d+$/.test(t)) cur.text.push(t);
  }
  if (cur && cur.text.length)
    cues.push({ start: cur.start, end: cur.end, text: cur.text.join(" ").trim() });
  return cues.filter((c) => c.text);
}

/** YouTube json3: { events: [{ tStartMs, dDurationMs, segs: [{utf8}] }] } */
function parseJson3(raw: string) {
  const j = JSON.parse(raw);
  return (j.events ?? [])
    .filter((e: any) => e.segs)
    .map((e: any) => ({
      start: (e.tStartMs ?? 0) / 1000,
      end: ((e.tStartMs ?? 0) + (e.dDurationMs ?? 0)) / 1000,
      text: e.segs.map((s: any) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim(),
    }))
    .filter((c: any) => c.text);
}

function parseRaw(raw: string): TranscriptWord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("<")) return cuesToWords(parseTimedTextXml(trimmed));
  if (trimmed.startsWith("{")) {
    try {
      return cuesToWords(parseJson3(trimmed));
    } catch {
      return [];
    }
  }
  return cuesToWords(parseSrtVtt(trimmed));
}

/** Public alias used by lib/anywhere.ts for yt-dlp-written .vtt/.srt files. */
export const parseSubtitleText = parseRaw;

/** Splits phrase-level cues into word-level entries, spreading each cue's
 *  time window evenly across its words (good enough for caption sync). */
function cuesToWords(cues: { start: number; end: number; text: string }[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const cue of cues) {
    const parts = cue.text.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const step = Math.max(cue.end - cue.start, 0.05) / parts.length;
    parts.forEach((word, i) => {
      words.push({
        word,
        start: +(cue.start + step * i).toFixed(3),
        end: +(cue.start + step * (i + 1)).toFixed(3),
      });
    });
  }
  return words;
}

/** Coaxes a transcript out of whatever the scraper returned. Prefers an
 *  English track when several exist. Never throws — caption-less videos
 *  simply yield []. */
export async function extractTranscript(item: Record<string, any>): Promise<TranscriptWord[]> {
  const rawSubs: any = item.subtitles ?? item.transcript ?? item.captions ?? null;
  if (!rawSubs) return [];

  if (typeof rawSubs === "string") return parseRaw(rawSubs);

  if (Array.isArray(rawSubs)) {
    const enRank = (t: any) =>
      /en/i.test(String(t?.lang ?? t?.language ?? t?.title ?? "")) ? 0 : 1;
    const ordered = [...rawSubs].sort((a, b) => enRank(a) - enRank(b));
    for (const track of ordered) {
      if (typeof track === "string") {
        const words = parseRaw(track);
        if (words.length) return words;
        continue;
      }
      if (track?.data && typeof track.data === "string") {
        const words = parseRaw(track.data);
        if (words.length) return words;
        continue;
      }
      const url: string | undefined = track?.url ?? track?.link ?? track?.src;
      if (!url) continue;
      try {
        const res = await withRetry(() => fetch(url), 2);
        if (!res.ok) continue;
        const words = parseRaw(await res.text());
        if (words.length) return words;
      } catch {
        // try the next track
      }
    }
    return [];
  }

  if (typeof rawSubs === "object") {
    if (typeof rawSubs.data === "string") return parseRaw(rawSubs.data);
    if (typeof rawSubs.url === "string") {
      try {
        const res = await withRetry(() => fetch(rawSubs.url), 2);
        if (res.ok) return parseRaw(await res.text());
      } catch {
        /* fall through */
      }
    }
    // A map like { en: [ {url} ] } — flatten and retry as an array
    const flat = Object.values(rawSubs).flat();
    if (flat.length) return extractTranscript({ subtitles: flat });
  }
  return [];
}