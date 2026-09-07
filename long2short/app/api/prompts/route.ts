import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_EDIT_SYSTEM_PROMPT,
  getSavedSystemPrompt,
  saveSystemPrompt,
} from "../../../lib/prompts";

// GET → the currently effective system prompt (saved override, else default).
export async function GET() {
  const saved = getSavedSystemPrompt();
  return NextResponse.json({
    systemPrompt: saved ?? DEFAULT_EDIT_SYSTEM_PROMPT,
    isDefault: !saved,
  });
}

// POST → save an override. { systemPrompt: null } (or empty string) resets to
// the default. Returns the now-effective prompt either way.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sp =
      typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
    saveSystemPrompt(sp.length ? sp : null);
    const saved = getSavedSystemPrompt();
    return NextResponse.json({
      ok: true,
      systemPrompt: saved ?? DEFAULT_EDIT_SYSTEM_PROMPT,
      isDefault: !saved,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Save failed" }, { status: 500 });
  }
}