import { NextRequest, NextResponse } from "next/server";
import {
  executePostAction,
  executeRepurposeAction,
} from "../../../../lib/chat";

export const runtime = "nodejs";
export const maxDuration = 300; // repurpose can fetch via Apify + rewrite

/**
 * Executes a chat-confirmed action. The chat route NEVER executes anything —
 * it only proposes; the user must hit Confirm in the UI, which lands here.
 */
export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();
    if (!action || typeof action !== "object") {
      return NextResponse.json({ error: "action object is required" }, { status: 400 });
    }

    if (action.action === "post") {
      const result = await executePostAction(action);
      return NextResponse.json({ result });
    }
    if (action.action === "repurpose") {
      if (!action.postUrl) {
        return NextResponse.json({ error: "postUrl is required" }, { status: 400 });
      }
      const result = await executeRepurposeAction(action);
      return NextResponse.json({ result });
    }
    return NextResponse.json(
      { error: `Unknown action type: ${action.action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "action failed" }, { status: 500 });
  }
}