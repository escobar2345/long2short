// Chat assistant brain. A fast flash-class model that can (1) PROPOSE posts
// to any saved Buffer channel and (2) fetch an existing post from any URL
// (yt-dlp / Apify, lib/socialFetch.ts) and rewrite it per-platform.
//
// PROPOSE-ONLY: runChat never executes anything. When a reply needs a real
// world effect it embeds ONE fenced ```action``` JSON block; the UI renders
// that behind a Confirm button, and only /api/chat/execute (user click) calls
// executePostAction / executeRepurposeAction. Nothing posts without a click.
import { listAccounts } from "./accounts";
import { listChannels, createPost } from "./buffer";
import { fetchPostContent } from "./socialFetch";
import { withRetry } from "./retry";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveViaPublicDns } from "./resilientDns";
// Transport note: NVIDIA calls in this module go through curl.exe (Windows
// schannel TLS) pinned to a public-DNS IP via --resolve — see the curlChatOnce
// comment for why. lib/resilientDns.ts still installs resilient DNS
// process-wide at boot (instrumentation.ts) for every other outbound call
// (NVIDIA SDK elsewhere in the app, Apify, Buffer).

const CHAT_MODEL =
  process.env.NVIDIA_CHAT_MODEL ?? "deepseek-ai/deepseek-v4-flash-0731";

function nvidiaBase(): string {
  if (!process.env.NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY is not set — get one at build.nvidia.com");
  }
  return (process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(
    /\/+$/,
    ""
  );
}

/**
 * One chat completion via curl.exe (Windows schannel TLS) — NON-STREAMING.
 *
 * WHY CURL: this machine's network middlebox stalls node/OpenSSL TLS
 * connections to integrate.api.nvidia.com regardless of TLS version, DNS
 * strategy, or fetch implementation — verified with a TLS diagnostic on
 * 2026-09-03. curl.exe (schannel TLS stack, ships with Windows 10/11)
 * succeeds against the same endpoint on the same network, so this transport
 * shells out to it. The request body is written to a temp file
 * (`--data @file`) to avoid Windows command-line length limits, and the
 * resolved IP is pinned with --resolve (public DNS via lib/resilientDns.ts)
 * so curl never touches the flaky router resolver.
 *
 * WHY NOT STREAMING (SSE): decisive live testing on 2026-09-03 showed the
 * middlebox swallows SSE response streams SPECIFICALLY — every stream:true
 * call hung at "request fully sent, zero response bytes" (from the shell AND
 * the server, with a pinned IP), while every stream:false call through the
 * same stack succeeded (the edit-plan path has always been stream:false and
 * always worked). So this transport sends stream:false and reads ONE JSON
 * body. Consequence: nothing arrives until the whole generation finishes,
 * so there is no idle watchdog — curl's `-m` cap is the total timeout and
 * withRetry re-attempts transient failures.
 */
export async function curlChatOnce(payload: string): Promise<string> {
  const bodyFile = path.join(
    os.tmpdir(),
    `l2s-chat-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(bodyFile, payload, "utf8");

  // curl.exe resolves hostnames with the WINDOWS system resolver — the same
  // flaky router DNS that stalls everything else on this machine. Resolve the
  // host here via 1.1.1.1/8.8.8.8 (lib/resilientDns.ts) and pin it with
  // --resolve so curl never touches the system resolver. SNI/Host stay the
  // real hostname, so TLS validation is unaffected. If public DNS is
  // unreachable, resolveArgs stays empty and curl falls back to system DNS.
  const url = new URL(`${nvidiaBase()}/chat/completions`);
  const host = url.hostname;
  const port = url.port || "443";
  const ips = await resolveViaPublicDns(host);
  // Pin up to two IPs (curl tries them in order, so a dead edge IP doesn't
  // kill the attempt) and fail a stalled TCP connect after 8s so withRetry
  // moves to the next attempt instead of burning the per-attempt budget on a
  // dead socket. Empty ips -> no pin, curl uses the system resolver.
  const resolveArgs: string[] = ips
    .slice(0, 2)
    .flatMap((ip) => ["--resolve", `${host}:${port}:${ip}`]);
  resolveArgs.push("--connect-timeout", "8");

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        fs.unlinkSync(bodyFile);
      } catch {
        /* temp file best-effort */
      }
      fn();
    };

    const child = spawn(
      "curl.exe",
      [
        "-sS",
        "--fail-with-body", // non-2xx HTTP → non-zero exit, body still on stdout
        "--connect-timeout",
        "8",
        "-m",
        // Per-attempt hard cap. During this network's "black hole" phases the
        // edge has provably answered requests that were kept open ~150s (see
        // friendlyNvidiaError) — killing attempts sooner guarantees failure.
        // Good-phase replies land in <2s, so this cap only matters in bad ones.
        "150",
        "-X",
        "POST",
        url.toString(),
        ...resolveArgs, // DNS pin — bypasses the Windows system resolver
        "-H",
        `Authorization: Bearer ${process.env.NVIDIA_API_KEY}`,
        "-H",
        "Content-Type: application/json",
        "--data",
        `@${bodyFile}`,
      ],
      { windowsHide: true }
    );

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => (stderr += c));

    child.on("error", (err) =>
      finish(() => reject(new Error(`curl network error: ${err.message}`)))
    );
    child.on("close", (code) => {
      if (code !== 0) {
        finish(() =>
          reject(
            new Error(
              `NVIDIA chat network failure via curl (exit ${code}): ${
                stderr.trim() || stdout.trim().slice(-200) || "no output"
              }`
            )
          )
        );
        return;
      }
      // Non-streaming response: one JSON body containing the full message.
      try {
        const j = JSON.parse(stdout);
        const text = j.choices?.[0]?.message?.content;
        if (typeof text === "string" && text.trim()) {
          finish(() => resolve(text));
        } else {
          finish(() =>
            reject(
              new Error(
                `NVIDIA returned no message content: ${stdout.trim().slice(0, 200)}`
              )
            )
          );
        }
      } catch {
        finish(() =>
          reject(
            new Error(
              `NVIDIA response was not JSON: ${stdout.trim().slice(-200) || "(empty body)"}`
            )
          )
        );
      }
    });
  });
}

async function chatCompletion(
  messages: { role: string; content: string }[],
  temperature: number
): Promise<string> {
  const payload = JSON.stringify({
    model: CHAT_MODEL,
    temperature,
    messages,
    // NON-STREAMING (see curlChatOnce): this machine's middlebox swallows
    // SSE response streams specifically; stream:false succeeds reliably.
    stream: false,
    // Repurpose replies (rewritten text for 1-3 platforms) fit well under
    // this; bounding it stops a runaway generation.
    max_tokens: 1200,
  });
  try {
    return await withRetry(() => curlChatOnce(payload), 3);
  } catch (err: any) {
    throw friendlyNvidiaError(err);
  }
}

/**
 * The user's network intermittently enters a "black hole" phase against
 * NVIDIA's edge: TCP + TLS + the full request go through, then zero response
 * bytes arrive (verified 2026-09-03 with verbose curl traces — including from
 * a bare shell with a pinned IP, so it is NOT an app bug). The phase passes
 * after a few minutes. Translate that specific signature into a message the
 * user can act on instead of a cryptic curl exit code.
 */
function friendlyNvidiaError(err: unknown): Error {
  const raw = String((err as any)?.message ?? err);
  const isStall =
    /exit 28|Operation timed out|timed out|empty reply|not JSON|no message content|0 bytes/i.test(
      raw
    );
  if (isStall) {
    return new Error(
      "The AI service (NVIDIA) is unreachable from your network right now — " +
        "connections open but no data comes back. This is a temporary phase of " +
        "your router/ISP (not a bug in the app) and it has consistently passed " +
        "after a few minutes: wait a moment and send your message again. — " +
        raw
    );
  }
  return new Error(raw);
}


export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** Live channel directory so the model never invents channel ids. */
async function channelDirectory(): Promise<string> {
  const accounts = await listAccounts();
  const lines: string[] = [];
  for (const acc of accounts) {
    try {
      const channels = await listChannels(acc.accessToken, acc.organizationId);
      lines.push(`Account "${acc.name}":`);
      for (const ch of channels) {
        lines.push(`  - [${ch.service}] ${ch.displayName} — channelId: ${ch.id}`);
      }
    } catch (err: any) {
      lines.push(`Account "${acc.name}": UNAVAILABLE (${err.message ?? err})`);
    }
  }
  return lines.join("\n") || "(no Buffer accounts configured)";
}

function systemPrompt(directory: string): string {
  return `You are the posting assistant inside the long2short app. You help the user post to their Buffer-connected social accounts, and repurpose an existing post from one platform so it fits another platform's algorithm.

LIVE CHANNEL DIRECTORY (the only channel ids that exist):
${directory}

RULES
- You NEVER execute anything. For any real-world effect, answer conversationally FIRST, then append exactly ONE fenced block on its own line:
\`\`\`action
{"action":"post","channelIds":["<id>"],"text":"<final text>","mode":"queue"}
\`\`\`
- "post" fields: channelIds (array, from the directory ONLY), text (final, ready to publish), mode "queue" (default) or "schedule" (+ dueAtIso ISO datetime), optional videoUrl (required by YouTube/TikTok channels for video posts).
- "repurpose" — when the user gives a post URL to adapt: {"action":"repurpose","postUrl":"https://...","targets":["twitter","tiktok","instagram","facebook","youtube"]}
- NEVER invent channelIds. If the directory has no channel for a platform, say so plainly.
- When the user asks "where can I post", answer from the directory without an action block.
- Keep replies short and concrete. When proposing post text, write it ready-to-publish for the TARGET platform (length limits, tone, hashtags).`;
}

export async function runChat(history: ChatMsg[]): Promise<string> {
  const directory = await channelDirectory();
  return chatCompletion(
    [
      { role: "system", content: systemPrompt(directory) },
      ...history.slice(-20),
    ],
    0.6
  );
}

/** Pulls the LAST fenced action block out of a reply. */
export function parseAction(reply: string): { clean: string; action: any | null } {
  const re = /```(?:action|json)?\s*\n?([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let found: any = null;
  let block: string | null = null;
  while ((m = re.exec(reply))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed.action === "string") {
        found = parsed;
        block = m[0];
      }
    } catch {
      /* not an action block */
    }
  }
  const clean = block ? reply.replace(block, "").trim() : reply.trim();
  return { clean, action: found };
}

/** Confirmed post: resolves each channelId to its owning account and posts. */
export async function executePostAction(action: any) {
  const text = String(action.text ?? "").trim();
  if (!text) throw new Error("The post action has no text to publish.");
  const ids: string[] =
    Array.isArray(action.channelIds) && action.channelIds.length
      ? action.channelIds.map(String)
      : action.channelId
        ? [String(action.channelId)]
        : [];
  if (!ids.length) throw new Error("No channels were selected for this post.");

  const mode = action.mode === "schedule" ? "schedule" : "queue";
  const accounts = await listAccounts();
  const owners = new Map<string, { token: string; label: string }>();
  for (const acc of accounts) {
    try {
      const chans = await listChannels(acc.accessToken, acc.organizationId);
      for (const ch of chans) {
        if (ids.includes(ch.id)) {
          owners.set(ch.id, {
            token: acc.accessToken,
            label: `${ch.displayName} [${ch.service}]`,
          });
        }
      }
    } catch {
      /* account unreachable — its channels simply won't match */
    }
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      const owner = owners.get(id);
      if (!owner) {
        return { channelId: id, ok: false, error: "no saved account owns this channelId" };
      }
      try {
        const post = await createPost(
          {
            channelId: id,
            text,
            mode,
            videoUrl: action.videoUrl || undefined,
            dueAtIso: action.dueAtIso || undefined,
          },
          owner.token
        );
        return { channelId: id, channel: owner.label, ok: true, postId: post?.id, dueAt: post?.dueAt };
      } catch (err: any) {
        return { channelId: id, channel: owner.label, ok: false, error: err.message ?? String(err) };
      }
    })
  );
  return { kind: "post", results };
}

const PLATFORM_STYLE: Record<string, string> = {
  twitter: "X/Twitter: hard max 280 chars, ONE sharp idea, no hashtag spam, punchy line breaks.",
  tiktok: "TikTok caption: 5-word hook first, casual voice, 3-5 trending-style hashtags.",
  instagram: "Instagram: emoji-rich, short lines, 5-10 hashtags at the end, save/share CTA.",
  facebook: "Facebook: conversational 2-4 sentences, link-friendly, max 1-2 hashtags.",
  youtube: "YouTube: title-style text, max 90 chars, keywords front-loaded.",
  dailymotion: "Dailymotion: concise descriptive title plus one sentence.",
};

/** Confirmed repurpose: fetch the original post, rewrite per target platform. */
export async function executeRepurposeAction(action: any) {
  const postUrl = String(action.postUrl ?? "");
  const targets: string[] =
    Array.isArray(action.targets) && action.targets.length
      ? action.targets.map(String)
      : ["twitter", "tiktok", "instagram"];
  const fetched = await fetchPostContent(postUrl);

  const raw = (
    await chatCompletion(
      [
        {
          role: "system",
          content:
            'You repurpose social posts for other platforms. Reply ONLY with JSON: {"drafts":[{"platform":"<target>","text":"<ready to publish>"}]} — one draft per requested target, same order.',
        },
        {
          role: "user",
          content: JSON.stringify({
            originalPlatform: fetched.platform,
            author: fetched.author ?? null,
            originalText: fetched.text,
            targets,
            styleGuide: PLATFORM_STYLE,
          }),
        },
      ],
      0.7
    )
  )
    .replace(/```json|```/g, "")
    .trim();
  let drafts: any[] = [];
  try {
    const parsed = JSON.parse(raw);
    drafts = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.drafts) ? parsed.drafts : [];
  } catch {
    throw new Error("The model returned malformed drafts — try again.");
  }
  return {
    kind: "repurpose",
    source: {
      platform: fetched.platform,
      url: fetched.url,
      via: fetched.via,
      author: fetched.author ?? null,
    },
    drafts: drafts.map((d) => ({
      platform: String(d.platform ?? "?"),
      text: String(d.text ?? ""),
    })),
  };
}
