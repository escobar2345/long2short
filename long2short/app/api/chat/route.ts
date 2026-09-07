import { NextRequest, NextResponse } from "next/server";
import { runChat, parseAction } from "../../../lib/chat";

export const runtime = "nodejs";
// Streaming keeps this bounded in practice, but a genuinely long generation
// on a slow link can run a few minutes — give it headroom (local dev ignores
// this; it matters when deployed to serverless).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }
    const history = messages
      .filter(
        (m: any) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
      )
      .map((m: any) => ({ role: m.role, content: m.content }));

    const reply = await runChat(history);
    const { clean, action } = parseAction(reply);
    return NextResponse.json({
      reply: clean || "(empty reply — try again)",
      pendingAction: action,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "chat failed" }, { status: 500 });
  }
}