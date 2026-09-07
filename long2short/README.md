# Long2Short

Turns a long-form YouTube video into short-form 9:16 clips using:

- **Apify** — fetches the source video, transcript, and (if the actor supports it) scene cuts
- **GLM via NVIDIA build.nvidia.com** — acts as the "editor": reads the transcript + your rules
  and outputs a structured edit plan (which moments to clip, caption timing, zoom/pan moves)
- **Remotion** — renders that edit plan into actual 9:16 `.mp4` files with captions and zoom/pan

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:

- `APIFY_TOKEN` — from your Apify account
- `APIFY_YOUTUBE_ACTOR_ID` — **you need to pick this.** Search the Apify Store for a
  YouTube transcript/scraper actor and paste its actor ID in. Different actors return
  different field names, so open `lib/apify.ts` and adjust the field mapping in
  `fetchVideoIntel()` to match whatever actor you choose.
- `NVIDIA_API_KEY` — from build.nvidia.com
- `NVIDIA_GLM_MODEL` — the exact model slug for the GLM model you have access to on
  build.nvidia.com. **Verify the current slug on the NVIDIA build catalog before running** —
  model names/availability there change, and I can't guarantee the placeholder
  (`zai-org/glm-4.6`) in `.env.local.example` is what's live when you read this.

```bash
npm run dev
```

## How the pipeline works

1. **Analyze** (`/api/analyze`) — you paste a YouTube URL, Apify returns title, duration,
   word-level transcript, and optionally scene cuts.
2. **Style profile (optional)** (`/api/style-profile`) — paste a sample short whose editing
   technique you want copied. GLM infers a structured "style profile" (cut pacing, caption
   style, zoom rhythm) from that sample's transcript/scene data.
3. **Rules** — free-text instructions plus clip count/length constraints. These live in the
   UI state, not hardcoded, so you can change them between every single run.
4. **Generate edit plan** (`/api/edit-plan`) — GLM receives the transcript, your current
   rules, and the optional style profile, and returns a JSON `EditPlan`: which time ranges
   to clip, per-clip captions with timing, and zoom/pan keyframes.
5. **Render** (`/api/render`) — for each clip, Remotion's renderer (`@remotion/renderer`)
   renders the `ShortClip` composition (`remotion/ShortClip.tsx`) into an `.mp4` using that
   clip's plan: 9:16 crop, burned-in captions, zoom/pan.

6. **Post via Buffer** (`/api/buffer/post`) — once a clip is rendered, pick ANY
   channels across ALL your saved Buffer accounts (checkboxes grouped by account),
   write one caption, choose "add to queue" or "schedule," and post. The route
   fans out concurrently: every selected channel on every selected account gets
   its own post request fired in parallel, so multiple accounts post at the same
   time, not one after another. Per-target results are reported back
   (succeeded/failed counts). Buffer publishes each post out to whichever platform
   that channel is (Instagram, TikTok, YouTube Shorts, X, LinkedIn, etc).

## Multiple Buffer accounts

- Add accounts in the **Buffer accounts** panel of the UI: a display name and
  the account's personal API key (create one at buffer.com → Settings → API).
  The organization ID is **auto-detected from the token** via Buffer's `account`
  GraphQL query — you only paste it manually if one token reaches multiple
  organizations. Every addition is validated live against Buffer, so a revoked
  token or wrong org ID fails right there with a real reason instead of
  mysterious channel-loading errors later.
- Stored server-side in `data/accounts.json` (gitignored); access tokens are
  masked before they're ever sent back to the browser.
- If you've set `BUFFER_ACCESS_TOKEN`/`BUFFER_ORGANIZATION_ID` in `.env.local`
  but haven't saved any accounts yet, they show up as a fallback **Default**
  account so old setups keep working unchanged.
- Posting is simultaneous across accounts — `/api/buffer/post` resolves each
  target's credentials server-side and fires all posts in parallel. One account
  failing or rate-limiting never blocks the others.

## Analytics & growth advice (Buffer)

The **Analytics & growth advice** panel pulls recent sent posts + engagement
numbers for any saved account. Buffer's GraphQL API is in beta and doesn't
expose analytics fields uniformly, so the fetcher tries, in order:

1. GraphQL channel statistics (`statistics { impressions reach ... }`)
2. Buffer's classic REST v1 API (`/profiles/:id/updates/sent.json`), which has
   long exposed per-post statistics
3. Graceful degradation — channel names only, with a clear warning

Whatever it finds is handed to GLM, which returns per-channel advice: what your
top posts have in common, cadence/timing suggestions, caption/format tweaks.
When no real numbers are available it says so and gives test-first guidance
instead of inventing stats.

## Caption coach (Apify + AI)

The **Caption coach** panel takes a topic (and optionally your draft caption):

1. Apify runs a Google SERP actor (default `apify/google-search-scraper`,
   override with `APIFY_SEARCH_ACTOR_ID`) against three queries about your topic
   — viral hooks, trending hashtags, audience-growth content.
2. GLM receives the live search snippets plus your draft caption and the
   platforms you've checked for the target clip, then writes a rewritten
   platform-specific caption (hook first line, CTA), researched hashtags, and
   concrete reach tips. Sources are listed so you can see what informed it.

## Buffer setup

1. Connect the social accounts you want to post to inside your actual Buffer account first
   (buffer.com) — this app posts *through* Buffer, it doesn't connect to TikTok/Instagram/etc
   directly.
2. Generate a personal API key at **buffer.com → Settings → API** and set
   `BUFFER_ACCESS_TOKEN`. Buffer can invalidate an API key at any time — if a key
   that worked suddenly stops working, generate a fresh one and update it in the app.
3. `BUFFER_ORGANIZATION_ID` is **optional**: long2short resolves your
   organization from the token automatically via Buffer's `account` query.
   Set it only if one key reaches multiple Buffer organizations and you want
   to pin a specific one.
4. Set `NEXT_PUBLIC_BASE_URL` to your **real deployed domain**, not `localhost`. This is not
   optional: Buffer's API has no file-upload endpoint — it only accepts a public URL and
   fetches the media itself, both when you create the post and again when it publishes
   (which can be hours or days later for scheduled/queued posts). If you're testing locally,
   posting will fail because Buffer's servers can't reach `localhost`. Deploy somewhere
   public (Vercel, etc.) or tunnel with something like ngrok for local testing, and make sure
   the render output stays on disk/reachable until the post actually goes out — don't clear
   `public/renders` right after posting.
5. Avoid signed/expiring URLs for the video — `NEXT_PUBLIC_BASE_URL` + the static
   `/renders/*.mp4` path Next.js serves from `public/` works fine since it's a plain public
   file, not a signed link.



GLM itself is a **text** model — it can't watch a sample video's raw frames. There are two
ways this app handles style extraction, toggled by the "Use vision model" checkbox in step 2:

- **Off (default, text-only)** — `extractStyleProfile()` infers cut length/caption/zoom
  patterns from the sample's transcript timing and scene-cut timestamps only.
- **On (vision-based)** — `extractStyleProfileVision()` pulls ~8 evenly-spaced frames from
  the sample video with `ffmpeg` (via `lib/ffmpegFrames.ts`) and sends them as `image_url`
  blocks to a vision-capable model on build.nvidia.com. Requires:
  - `ffmpeg` installed and on `PATH` wherever this app runs (not bundled — install it
    separately, e.g. `apt install ffmpeg` / `brew install ffmpeg`).
  - `NVIDIA_VISION_MODEL` set in `.env.local` to a real vision-capable catalog ID. Check
    **build.nvidia.com/models** for what's currently available and confirm the exact ID on
    that model's own page — the catalog changes, so don't trust the placeholder value as-is.

Both paths return the same `StyleProfile` shape, so nothing downstream (the edit-plan prompt,
Remotion) needs to change based on which one you use.

One more limit: even vision-capable models on the shared hosted endpoint
(`integrate.api.nvidia.com`) take **images**, not a raw video stream — that's why frames are
extracted first rather than uploading the `.mp4` directly. True video-token input is
documented for self-hosted NIM containers with video input explicitly enabled, not the
shared hosted catalog endpoint.

## Known gaps to fill in for production

- `lib/apify.ts` has placeholder field names (`item.transcript`, `item.videoUrl`, etc.) —
  update these to match your chosen actor's actual output schema.
- Video download: some Apify actors give you a direct playable/download URL; others don't.
  If yours doesn't, add a download step (e.g. `yt-dlp`) before the video path is handed to
  Remotion, since `OffthreadVideo` needs a URL or local file it can read.
- Rendering is synchronous in `/api/render` today — for long videos/many clips, move this to
  a background job/queue (e.g. a worker process or `@remotion/lambda`) instead of blocking
  an API route.
- No auth/rate-limiting is included — add it before deploying publicly, since rendering is
  expensive.
- Buffer's GraphQL API is in public beta as of this writing and its schema/rate limits may
  shift — if `createPost`/channel queries in `lib/buffer.ts` start erroring, check
  developers.buffer.com for schema changes before assuming the code is wrong.
- `public/renders` grows forever since nothing deletes old clips — add cleanup once a post
  has published (check Buffer's post status) or on a retention schedule.
