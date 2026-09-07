"use client";

// Floating chat assistant. PROPOSE-ONLY: the model's replies may carry an
// ```action``` block; nothing runs until the user hits Confirm, which calls
// /api/chat/execute. Matches the app's dark panel styling.

import React, { useEffect, useRef, useState } from "react";

const ACCENT = "#FF5A1F";
const PANEL = "#15171A";
const BORDER = "#2A2D31";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

function fmtResult(r: any): string {
  if (r?.kind === "post") {
    const lines = (r.results ?? []).map((x: any) =>
      x.ok
        ? `✅ ${x.channel ?? x.channelId} — queued (post ${x.postId ?? "?"})`
        : `❌ ${x.channel ?? x.channelId} — ${x.error}`
    );
    const ok = r.results?.filter((x: any) => x.ok).length ?? 0;
    return `Posted to ${ok}/${r.results?.length ?? 0} channels:\n${lines.join("\n")}`;
  }
  if (r?.kind === "repurpose") {
    const src = `Fetched from ${r.source.platform} (${r.source.via})`;
    const drafts = (r.drafts ?? [])
      .map((d: any) => `--- ${d.platform} ---\n${d.text}`)
      .join("\n\n");
    return `${src}. Rewritten drafts — tell me "post the twitter one to ..." to publish any of them:\n\n${drafts}`;
  }
  return JSON.stringify(r, null, 2);
}

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<any | null>(null);
  const [executing, setExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 10_000_000 });
  }, [messages, pending, open, executing]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setMessages((m) => [...m, { role: "assistant", content: j.reply }]);
      if (j.pendingAction) setPending(j.pendingAction);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ ${err.message ?? "chat failed"}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (!pending || executing) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/chat/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pending }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setMessages((m) => [...m, { role: "assistant", content: fmtResult(j.result) }]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ ${err.message ?? "action failed"}` },
      ]);
    } finally {
      setExecuting(false);
      setPending(null);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 60,
          background: ACCENT,
          color: "#fff",
          border: "none",
          borderRadius: 999,
          padding: "14px 22px",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 6px 24px rgba(0,0,0,.45)",
          fontSize: 15,
        }}
      >
        💬 Chat assistant
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 60,
        width: 400,
        maxWidth: "calc(100vw - 32px)",
        height: "min(620px, 80vh)",
        background: PANEL,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 10px 40px rgba(0,0,0,.55)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: `1px solid ${BORDER}`,
          fontWeight: 700,
          color: "#e6e8ea",
        }}
      >
        <span>💬 Posting assistant</span>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: "none",
            border: "none",
            color: "#9aa0a6",
            cursor: "pointer",
            fontSize: 18,
          }}
          aria-label="Close chat"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {messages.length === 0 && (
          <div style={{ color: "#8b9096", fontSize: 14, lineHeight: 1.7 }}>
            Ask me things like:
            <br />• “What channels can I post to?”
            <br />• “Queue ‘Behind the scenes of today’s shoot 🎬’ to my two Twitter accounts”
            <br />• “Repurpose this TikTok for Twitter and Instagram: &lt;url&gt;”
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              margin: "8px 0",
              background: m.role === "user" ? ACCENT : "#1d2024",
              color: m.role === "user" ? "#fff" : "#e6e8ea",
              padding: "9px 12px",
              borderRadius: 10,
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.5,
              maxWidth: "92%",
              marginLeft: m.role === "user" ? "auto" : 0,
            }}
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div style={{ color: "#8b9096", fontSize: 13, padding: "6px 2px" }}>thinking…</div>
        )}

        {pending && (
          <div
            style={{
              marginTop: 10,
              border: `1px solid ${ACCENT}`,
              borderRadius: 10,
              padding: 12,
              fontSize: 13,
              color: "#e6e8ea",
            }}
          >
            <b style={{ color: ACCENT }}>
              Confirm {pending.action === "post" ? "post" : "repurpose"}?
            </b>
            <pre
              style={{
                margin: "8px 0",
                whiteSpace: "pre-wrap",
                fontSize: 12,
                color: "#9aa0a6",
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              {JSON.stringify(pending, null, 2)}
            </pre>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={confirmAction}
                disabled={executing}
                style={{
                  background: ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "7px 14px",
                  fontWeight: 700,
                  cursor: executing ? "wait" : "pointer",
                }}
              >
                {executing ? "Running…" : "Confirm"}
              </button>
              <button
                onClick={() => setPending(null)}
                disabled={executing}
                style={{
                  background: "transparent",
                  color: "#9aa0a6",
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "7px 14px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${BORDER}` }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="e.g. repurpose this post for TikTok: <url>"
          style={{
            flex: 1,
            background: "#0f1113",
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            color: "#e6e8ea",
            padding: "10px 12px",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          style={{
            background: ACCENT,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 16px",
            fontWeight: 700,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}