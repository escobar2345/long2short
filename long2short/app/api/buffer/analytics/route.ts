import { NextRequest, NextResponse } from "next/server";
import { fetchAccountAnalytics, type AccountAnalytics } from "../../../../lib/buffer";
import { getAccount, publicAccount } from "../../../../lib/accounts";

export const runtime = "nodejs";

/** Summarizes raw analytics into a compact text blob for the GLM prompt. */
function performanceContext(analytics: AccountAnalytics): string {
  return JSON.stringify(
    analytics.channels.map((ch) => ({
      channel: `${ch.displayName} (${ch.service})`,
      recentPosts: ch.posts.slice(0, 5).map((p) => ({
        caption: p.text.slice(0, 120),
        postedAt: p.createdAt,
        metrics: p.metrics,
      })),
    }))
  );
}

/** GET ?accountId=... — raw per-channel engagement numbers for one account. */
export async function GET(req: NextRequest) {
  try {
    const accountId = req.nextUrl.searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId query param is required" }, { status: 400 });
    }
    const account = await getAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const analytics = await fetchAccountAnalytics(
      account.accessToken,
      account.organizationId
    );
    return NextResponse.json({
      account: publicAccount(account),
      ...analytics,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to load analytics" }, { status: 500 });
  }
}

/**
 * POST { accountId } — fetches the account's analytics AND runs GLM over them
 * to produce per-channel advice on how to post for more views/reach.
 */
export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();
    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    const account = await getAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const analytics = await fetchAccountAnalytics(
      account.accessToken,
      account.organizationId
    );

    const openaiModule = await import("openai");
    const glm = new openaiModule.default({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    });

    const completion = await glm.chat.completions.create({
      model: process.env.NVIDIA_GLM_MODEL ?? "deepseek-ai/deepseek-v4-pro-0813",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: `You are a short-form video growth analyst. You receive recent post
performance from a creator's Buffer channels. For EACH channel give concrete,
data-driven advice on how to get more views: what their top posts have in
common, posting cadence/timing, format tweaks, caption/hashtag changes.
If no real numbers are available say what you'd test first instead of inventing stats.

Respond with ONLY valid JSON matching this TypeScript type, no prose, no
markdown fences:

type AnalyticsAdvice = {
  overall: string;
  perChannel: { channel: string; bestPerforming: string; advice: string[] }[];
};`,
        },
        {
          role: "user",
          content: JSON.stringify({
            source: analytics.source,
            warning: analytics.warning ?? null,
            channels: performanceContext(analytics),
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let advice;
    try {
      advice = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch (err) {
      throw new Error(`GLM did not return valid JSON advice: ${String(err)}`);
    }

    return NextResponse.json({
      account: publicAccount(account),
      ...analytics,
      advice,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to analyze" }, { status: 500 });
  }
}