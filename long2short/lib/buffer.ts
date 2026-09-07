// Buffer's current API is a GraphQL API at api.buffer.com, auth'd with a
// personal API key as a Bearer token — no SDK needed, plain fetch works.
//
// MULTI-ACCOUNT: every function below takes the account's credentials
// explicitly (accessToken / organizationId) instead of reading process.env,
// so the same code drives ANY number of saved Buffer accounts concurrently.
// See lib/accounts.ts for how accounts are stored and
// app/api/buffer/post/route.ts for the simultaneous fan-out across them.
//
// IMPORTANT: Buffer's API has no file-upload endpoint. Every image/video you
// attach must be a publicly reachable URL — Buffer fetches it when the post
// is created and again when it actually publishes, so the URL has to stay
// live the whole time (no signed/expiring links). That's why `createVideoPost`
// below takes a `videoUrl` rather than a local file path — see
// app/api/buffer/post/route.ts for how the rendered clip is turned into one.
//
// SCHEMA NOTE (verified against the live API 2026-08-29): `channels` and
// `posts` are ROOT queries (channels(input:) / posts(input:)). The old
// organization(id:) { channels { ... } } shape NO LONGER EXISTS in the schema
// and returns FORBIDDEN for every token. Also, the classic REST v1 API
// rejects buffer.com/api "public API tokens" entirely ("Public API tokens are
// not accepted for REST API access") and is deprecated (sunset 2027-02), so
// REST-based analytics degrade gracefully via the fallback path below.

import type { BufferChannel } from "./types";
import { withRetry } from "./retry";

const BUFFER_API_URL = "https://api.buffer.com/graphql";
// Classic REST v1 API — kept around because it exposes post-level engagement
// numbers (reach/clicks/etc.) that the beta GraphQL schema does not reliably
// provide yet. Used as the analytics fallback path.
const BUFFER_REST_URL = "https://api.bufferapp.com/1";

// Node's fetch throws opaque TypeErrors like "fetch failed" when a network
// request can't even be made (DNS, VPN, proxy, firewall, TLS). The REAL reason
// hides in err.cause (e.g. "getaddrinfo ENOTFOUND api.buffer.com") — unwrap it
// so the UI shows why Buffer was unreachable instead of a useless message.
function describeFetchError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const cause: any = (err as any)?.cause;
  if (cause) {
    const detail = [cause.code, cause.message]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (detail && !base.includes(detail)) return `${base} (${detail})`;
  }
  return base;
}

async function bufferRequest<T>(
  query: string,
  variables: Record<string, any>,
  accessToken: string
): Promise<T> {
  let res: Response;
  try {
    // withRetry: the user's flaky router DNS intermittently SERVFAILs
    // api.buffer.com; a retry a couple of seconds later goes through.
    res = await withRetry(
      () =>
        fetch(BUFFER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ query, variables }),
          // Node fetch hangs indefinitely on a stalled connection — cap it so
          // withRetry can actually retry.
          signal: AbortSignal.timeout(20_000),
        }),
      3
    );
  } catch (err) {
    // Network-level failure — Buffer was never reached.
    throw new Error(describeFetchError(err));
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `UNAUTHENTICATED (HTTP ${res.status}) — Buffer rejected this access token`
    );
  }

  const json = await res.json().catch(() => null);
  if (!json) {
    throw new Error(`Buffer returned a non-JSON response (HTTP ${res.status})`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: any) => e.message).join("; "));
  }
  return json.data as T;
}

async function bufferRest<T>(pathName: string, accessToken: string): Promise<T> {
  let res: Response;
  try {
    res = await withRetry(
      () =>
        fetch(`${BUFFER_REST_URL}${pathName}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20_000),
        }),
      2
    );
  } catch (err) {
    throw new Error(describeFetchError(err));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buffer REST ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listChannels(
  accessToken: string,
  organizationId: string
): Promise<BufferChannel[]> {
  const query = `
    query Channels($input: ChannelsInput!) {
      channels(input: $input) {
        id
        service
        displayName
      }
    }
  `;
  const data = await bufferRequest<{ channels: BufferChannel[] | null }>(
    query,
    { input: { organizationId } },
    accessToken
  );
  return data.channels ?? [];
}

export interface BufferOrganization {
  id: string;
  name: string | null;
}

/**
 * List every Buffer organization the personal API key can reach using ONLY the
 * token — no 24-char org ID hunting in Buffer's UI. This is the GraphQL
 * replacement for REST's /user.json (see
 * https://developers.buffer.com/guides/rest-migration.html): the root `account`
 * query takes no args and returns the authenticated account's organizations.
 *
 * THROWS (never swallows): a dead token raises UNAUTHENTICATED (HTTP 401/403),
 * a network/DNS blip raises the transport error — the caller (lib/accounts.ts)
 * classifies these so a transient blip is never misreported as "invalid
 * token". An empty array means Buffer accepted the token but no orgs are
 * attached to it (genuinely nothing to auto-detect).
 */
export async function listOrganizations(
  accessToken: string
): Promise<BufferOrganization[]> {
  const query = `
    query AccountOrganizations {
      account {
        organizations { id name }
      }
    }
  `;
  const data = await bufferRequest<{
    account: {
      organizations: Array<{ id: string; name?: string | null }> | null;
    } | null;
  }>(query, {}, accessToken);
  return (data?.account?.organizations ?? [])
    .map((o) => ({ id: o?.id ?? "", name: o?.name ?? null }))
    .filter((o) => o.id.length > 0);
}

export interface CreatePostArgs {
  channelId: string;
  text: string;
  /** Omit for a plain text post (X/Twitter, etc.). Video channels need one. */
  videoUrl?: string;
  /** "queue" posts to the next open slot; "schedule" needs `dueAtIso` */
  mode: "queue" | "schedule";
  dueAtIso?: string;
}

export async function createPost(args: CreatePostArgs, accessToken: string) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post { id text dueAt assets { id mimeType } }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const input: Record<string, any> = {
    text: args.text,
    channelId: args.channelId,
    schedulingType: "automatic",
    mode: args.mode === "schedule" ? "customScheduled" : "addToQueue",
    // REQUIRED non-null Boolean in the current schema — omitting it fails validation.
    needsApproval: false,
  };
  // Assets are only included when a video is attached — an empty assets array
  // fails validation for text-only posts (used by the chat assistant).
  if (args.videoUrl) {
    input.assets = [{ video: { url: args.videoUrl } }];
  }
  if (args.mode === "schedule") {
    if (!args.dueAtIso) throw new Error("dueAtIso is required when mode is 'schedule'");
    input.dueAt = args.dueAtIso;
  }

  const data = await bufferRequest<{ createPost: any }>(mutation, { input }, accessToken);

  if (data.createPost?.message) {
    // MutationError branch
    throw new Error(data.createPost.message);
  }
  return data.createPost.post;
}

export interface CreateVideoPostArgs extends CreatePostArgs {
  videoUrl: string;
}

export async function createVideoPost(args: CreateVideoPostArgs, accessToken: string) {
  return createPost(args, accessToken);
}

// ---------------------------------------------------------------------------
// ANALYTICS
// ---------------------------------------------------------------------------

export interface ChannelAnalytics {
  channelId: string;
  service: string;
  displayName: string;
  /** Recent sent posts with whatever engagement numbers Buffer exposes. */
  posts: Array<{
    id: string;
    text: string;
    createdAt?: string;
    metrics: Record<string, number>;
  }>;
  error?: string;
}

export interface AccountAnalytics {
  channels: ChannelAnalytics[];
  source: "graphql" | "rest" | "none";
  warning?: string;
}

/**
 * Pull recent sent posts + engagement numbers for EVERY channel in one
 * account. Buffer's GraphQL API is beta and analytics fields vary by plan, so
 * this tries, in order:
 *   1. GraphQL — organization.channels with per-channel recent post metrics
 *   2. Classic REST v1 — /profiles/:id/updates/sent.json which has long
 *      exposed statistics (reach/clicks/favorites/etc.) per sent update
 *   3. Graceful degradation — returns channel names with a warning so the UI
 *      can still render and the AI advice layer can fall back to general
 *      best-practice guidance instead of hard-failing.
 */
export async function fetchAccountAnalytics(
  accessToken: string,
  organizationId: string,
  postsPerChannel = 10
): Promise<AccountAnalytics> {
  // --- Attempt 1: GraphQL --------------------------------------------------
  try {
    // Modern schema: channels + posts are ROOT queries. Sent posts are fetched
    // org-wide and grouped per channel in JS (the old per-channel posts
    // connection under organization.channels no longer exists).
    const query = `
      query ChannelAnalytics($channelsInput: ChannelsInput!, $postsInput: PostsInput!, $first: Int) {
        channels(input: $channelsInput) {
          id
          service
          displayName
        }
        posts(input: $postsInput, first: $first) {
          edges {
            node {
              id
              text
              dueAt
              channelId
              metrics { name value }
            }
          }
        }
      }
    `;
    const data = await bufferRequest<any>(
      query,
      {
        channelsInput: { organizationId },
        postsInput: { organizationId, filter: { status: ["sent"] } },
        first: postsPerChannel * 10, // org-wide cap, trimmed per channel below
      },
      accessToken
    );

    const byChannel = new Map<string, ChannelAnalytics>();
    for (const ch of data?.channels ?? []) {
      byChannel.set(ch.id, {
        channelId: ch.id,
        service: ch.service,
        displayName: ch.displayName ?? ch.id,
        posts: [],
      });
    }
    for (const edge of data?.posts?.edges ?? []) {
      const n = edge?.node;
      if (!n) continue;
      const target = byChannel.get(n.channelId);
      if (!target || target.posts.length >= postsPerChannel) continue;
      // PostMetric = { name, value } pairs — flatten into a plain record.
      const metrics: Record<string, number> = {};
      for (const m of n.metrics ?? []) {
        const v = typeof m?.value === "number" ? m.value : Number(m?.value);
        if (m?.name && Number.isFinite(v)) metrics[m.name] = v;
      }
      target.posts.push({
        id: n.id ?? "",
        text: n.text ?? "",
        createdAt: n.dueAt ?? undefined,
        metrics,
      });
    }
    if (byChannel.size > 0) {
      return { source: "graphql", channels: Array.from(byChannel.values()) };
    }
  } catch {
    // fall through to REST
  }

  return await fetchAccountAnalyticsRest(accessToken, organizationId, postsPerChannel);
}

async function fetchAccountAnalyticsRest(
  accessToken: string,
  organizationId: string,
  postsPerChannel: number
): Promise<AccountAnalytics> {
  try {
    const profiles = await bufferRest<Array<Record<string, any>>>("/profiles.json", accessToken);
    if (!Array.isArray(profiles)) throw new Error("unexpected /profiles.json response");

    const channels: ChannelAnalytics[] = await Promise.all(
      profiles.map(async (p) => {
        const base: ChannelAnalytics = {
          channelId: p.id ?? "",
          service: p.service ?? "",
          displayName: p.formatted_username ?? p.formatted_login ?? p.id ?? "",
          posts: [],
        };
        try {
          const sent = await bufferRest<{ updates?: any[] }>(
            `/profiles/${p.id}/updates/sent.json`,
            accessToken
          );
          base.posts = (sent.updates ?? []).slice(0, postsPerChannel).map((u: any) => ({
            id: u.id ?? "",
            text: u.text ?? "",
            createdAt: u.due_at ? new Date(u.due_at * 1000).toISOString() : undefined,
            metrics: normalizeRestStats(u.statistics ?? {}),
          }));
        } catch (e: any) {
          base.error = e.message;
        }
        return base;
      })
    );

    return {
      source: "rest",
      channels,
      warning:
        "Analytics served from Buffer's classic REST API (the GraphQL beta does not expose these fields on your plan/token).",
    };
  } catch (e: any) {
    // --- Attempt 3: graceful degradation -----------------------------------
    let channels: ChannelAnalytics[] = [];
    try {
      channels = (await listChannels(accessToken, organizationId)).map((c) => ({
        channelId: c.id,
        service: c.service,
        displayName: c.displayName,
        posts: [],
      }));
    } catch {
      // even channel listing failed — leave empty; caller surfaces the error
    }
    return {
      source: "none",
      channels,
      warning: `Could not fetch engagement data (${
        e.message ?? "unknown error"
      }). Advice is based on general short-form best practices instead of your actual numbers.`,
    };
  }
}

function normalizeRestStats(statistics: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!statistics || typeof statistics !== "object") return out;
  // REST v1 returns numeric keys mapping to interaction objects, e.g.
  // { "0": { reach: 1200, favorite_count: 30 }, ... } — aggregate them.
  const values = Object.values(statistics) as any[];
  for (const entry of values) {
    if (!entry || typeof entry !== "object") continue;
    for (const [k, v] of Object.entries(entry)) {
      if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
    }
  }
  // Some plans expose flat numeric fields directly.
  for (const key of ["reach", "clicks", "favorites", "retweets", "likes"]) {
    const v = (statistics as Record<string, any>)[key];
    if (typeof v === "number") out[key] = Math.max(out[key] ?? 0, v);
  }
  return out;
}
