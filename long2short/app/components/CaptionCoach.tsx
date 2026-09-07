"use client";

// Caption coach UI: Apify searches the live internet around your topic, then
// GLM rewrites your caption per platform with researched hashtags + reach tips.

import React, { useState } from "react";
import type { PlatformCaption, ResearchSource } from "../../lib/captionCoach";
import {
  stepStyle,
  labelStyle,
  inputStyle,
  buttonStyle,
  buttonDisabled,
  ghostButtonStyle,
  cardStyle,
  TEXT_MUTED,
  BAD,
} from "./ui";

interface CoachResponse {
  captions: PlatformCaption[];
  tips: string[];
  researchNote: string;
  research: ResearchSource[];
  researchError?: string;
}

interface Props {
  /** Services of currently selected/available channels, for tailored advice. */
  platforms: string[];
  draftCaption: string;
  onApplyCaption: (caption: string) => void;
}

export default function CaptionCoach({ platforms, draftCaption, onApplyCaption }: Props) {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CoachResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCoach(skipResearch: boolean) {
    if (!topic.trim() || platforms.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          draftCaption: draftCaption || undefined,
          platforms,
          skipResearch,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Coaching failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={stepStyle}>
      <span style={labelStyle}>Caption coach · Apify web research + AI</span>
      <p style={{ fontSize: 13, color: TEXT_MUTED, margin: "0 0 12px" }}>
        Describe what this clip is about. Apify searches what&apos;s trending around that
        topic right now, then AI rewrites your caption per platform with hashtags and reach
        tips.
      </p>

      <input
        style={{ ...inputStyle, marginBottom: 10 }}
        placeholder={'Topic (e.g. "home gym workouts for beginners")'}
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          style={loading || !topic.trim() || platforms.length === 0 ? buttonDisabled : buttonStyle}
          disabled={loading || !topic.trim() || platforms.length === 0}
          onClick={() => handleCoach(false)}
        >
          {loading ? "Researching + writing…" : "Get coached captions"}
        </button>
        <button
          style={ghostButtonStyle}
          disabled={loading || !topic.trim()}
          onClick={() => handleCoach(true)}
        >
          Skip web research (save credits)
        </button>
      </div>

      {platforms.length === 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: TEXT_MUTED }}>
          Select at least one channel below to enable coaching.
        </div>
      )}

      {error && <div style={{ marginTop: 10, color: BAD, fontSize: 13 }}>{error}</div>}

      {result?.researchError && (
        <div style={{ marginTop: 10, color: "#E8B341", fontSize: 12 }}>{result.researchError}</div>
      )}

      {result && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: TEXT_MUTED }}>{result.researchNote}</div>

          {result.captions.map((c) => (
            <div key={c.platform} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 13 }}>{c.platform}</strong>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={ghostButtonStyle}
                    onClick={() => navigator.clipboard.writeText(c.caption)}
                  >
                    Copy
                  </button>
                  <button
                    style={{ ...ghostButtonStyle, borderColor: "#FF5A1F", color: "#FF5A1F" }}
                    onClick={() => onApplyCaption(c.caption)}
                  >
                    Use
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 13, whiteSpace: "pre-wrap" }}>{c.caption}</div>
              {c.hashtags.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: TEXT_MUTED }}>
                  {c.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
                </div>
              )}
            </div>
          ))}

          {result.tips.length > 0 && (
            <div style={cardStyle}>
              <span style={labelStyle}>Reach tips</span>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {result.tips.map((t, i) => (
                  <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.research.length > 0 && (
            <details style={{ ...cardStyle, cursor: "pointer" }}>
              <summary style={{ fontSize: 13, fontWeight: 600 }}>
                Sources ({result.research.length})
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {result.research.slice(0, 10).map((r, i) => (
                  <li key={i} style={{ fontSize: 12, marginBottom: 6 }}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#FF5A1F" }}>
                        {r.title || r.url}
                      </a>
                    ) : (
                      r.title
                    )}
                    <div style={{ color: TEXT_MUTED }}>{r.description.slice(0, 140)}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
