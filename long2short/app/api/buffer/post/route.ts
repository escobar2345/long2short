import { NextRequest, NextResponse } from "next/server";
import { createVideoPost } from "../../../../lib/buffer";
import { getAccount } from "../../../../lib/accounts";
import { getPublicBaseUrl } from "../../../../lib/tunnel";

export const runtime = "nodejs";

interface PostTarget {
  accountId: string;
  channelId: string;
  /** Optional per-platform caption override; falls back to the shared caption. */
  caption?: string;
}

/**
 * Posts one rendered clip to MANY channels across MANY Buffer accounts
 * SIMULTANEOUSLY. Each target resolves to its own saved account credentials,
 * then every post request fires in parallel via Promise.allSettled — one
 * account failing or rate-limiting never blocks the others.
 *
 * Body: { renderedPath, targets: [{ accountId, channelId, caption? }], caption, mode, dueAtIso }
 */
export async function POST(req: NextRequest) {
  try {
    const { renderedPath, targets, caption, mode, dueAtIso } = await req.json();

    if (!renderedPath || !caption || !mode) {
      return NextResponse.json(
        { error: "renderedPath, caption, and mode are required" },
        { status: 400 }
      );
    }

    const targetList: PostTarget[] = Array.isArray(targets)
      ? targets
      : // Legacy single-channel shape from before multi-account support.
        [];
    if (targetList.length === 0) {
      return NextResponse.json(
        { error: "targets must be a non-empty array of { accountId, channelId }" },
        { status: 400 }
      );
    }

    // Buffer fetches media from a public URL — it has no upload endpoint —
    // and that URL has to stay reachable until the post actually publishes,
    // not just at the moment you call this route. `renderedPath` is the
    // relative path returned by /api/render (e.g. "/renders/clip-0.mp4"),
    // served from Next's /public. getPublicBaseUrl() makes the app come
    // online BY ITSELF: it trusts NEXT_PUBLIC_BASE_URL when the video answers
    // through it (the production path — Fly.io/Vercel/etc.), otherwise it
    // spins up / reuses an ngrok tunnel so local dev works and Buffer never
    // sees a localhost URL.
    let baseUrl: string;
    try {
      baseUrl = await getPublicBaseUrl(renderedPath);
    } catch (err: any) {
      return NextResponse.json(
        { error: err.message ?? "No public URL is available for the video" },
        { status: 500 }
      );
    }
    const videoUrl = `${baseUrl.replace(/\/$/, "")}${renderedPath}`;

    // Resolve every referenced account up front (tokens stay server-side).
    const accountCache = new Map<string, Awaited<ReturnType<typeof getAccount>>>();
    for (const t of targetList) {
      if (!accountCache.has(t.accountId)) {
        accountCache.set(t.accountId, await getAccount(t.accountId));
      }
    }

    // Fan out — all posts fire concurrently across all accounts.
    const settled = await Promise.all(
      targetList.map(async (t) => {
        try {
          const account = accountCache.get(t.accountId);
          if (!account) throw new Error(`Unknown account: ${t.accountId}`);

          const post = await createVideoPost(
            {
              channelId: t.channelId,
              text: t.caption?.trim() || caption,
              videoUrl,
              mode,
              dueAtIso,
            },
            account.accessToken
          );

          return { accountId: t.accountId, channelId: t.channelId, ok: true as const, post };
        } catch (err: any) {
          return {
            accountId: t.accountId,
            channelId: t.channelId,
            ok: false as const,
            error: err.message ?? "Post failed",
          };
        }
      })
    );

    const succeeded = settled.filter((r) => r.ok);
    const failed = settled.filter((r) => !r.ok);

    return NextResponse.json({
      results: settled,
      publicBaseUrl: baseUrl,
      summary: {
        total: settled.length,
        succeeded: succeeded.length,
        failed: failed.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to post to Buffer" }, { status: 500 });
  }
}
