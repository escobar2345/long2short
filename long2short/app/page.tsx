"use client";

import React, { useState, useEffect } from "react";
import type { VideoIntel, StyleProfile, EditRules, EditPlan } from "../lib/types";
import type { PublicAccount, AccountChannels, PostResponse } from "../lib/clientTypes";
import type { ConfigStatus } from "../lib/config";
import AccountsManager from "./components/AccountsManager";
import CaptionCoach from "./components/CaptionCoach";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ChatPanel from "./components/ChatPanel";

const ACCENT = "#FF5A1F";
const PANEL = "#15171A";
const BORDER = "#2A2D31";

const stepStyle: React.CSSProperties = {
  background: PANEL,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: 24,
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: "#8A8D93",
  marginBottom: 8,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0F1012",
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: "10px 12px",
  color: "#E8E6E1",
  fontSize: 14,
  fontFamily: "inherit",
};

const buttonStyle: React.CSSProperties = {
  background: ACCENT,
  color: "#0B0C0E",
  border: "none",
  borderRadius: 6,
  padding: "10px 18px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const buttonDisabled: React.CSSProperties = {
  ...buttonStyle,
  background: "#3A3D42",
  color: "#8A8D93",
  cursor: "not-allowed",
};

function chipStyle(checked: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${checked ? ACCENT : BORDER}`,
    background: checked ? "#241407" : "transparent",
    color: checked ? ACCENT : "#E8E6E1",
    cursor: "pointer",
    userSelect: "none",
  };
}

type ExistingRender = {
  file: string;
  url: string;
  sizeMb: number;
  modified: string;
  sourceUrl?: string | null;
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
  hookTitle?: string | null;
};

/** Extracts the YouTube video id from any common URL shape (for matching
 *  rendered files to the current video regardless of URL format). */
function ytId(url: string | null | undefined): string {
  if (!url) return "";
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : url;
}

export default function Page() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [rulesText, setRulesText] = useState(
    "Prioritize the most quotable, self-contained moments. Keep energy high from the first second."
  );
  const [targetClipCount, setTargetClipCount] = useState(3);
  const [minSec, setMinSec] = useState(20);
  const [maxSec, setMaxSec] = useState(60);

  const [intel, setIntel] = useState<VideoIntel | null>(null);
  // True when analyze returned metadata but the video FILE still needs to be
  // downloaded (that happens lazily at render time — see /api/render).
  const [filePending, setFilePending] = useState(false);
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(null);
  const [editPlan, setEditPlan] = useState<EditPlan | null>(null);
  const [renderedUrls, setRenderedUrls] = useState<Record<number, string>>({});
  const [existingRenders, setExistingRenders] = useState<ExistingRender[]>([]);

  const [accountChannels, setAccountChannels] = useState<AccountChannels[]>([]);
  const [savedAccounts, setSavedAccounts] = useState<PublicAccount[]>([]);
  // Per clip: which channels (across WHICH accounts) are checked for posting.
  // Key format: "<accountId>:<channelId>"
  const [selectedTargets, setSelectedTargets] = useState<Record<number, Record<string, boolean>>>({});
  const [caption, setCaption] = useState<Record<number, string>>({});
  const [postMode, setPostMode] = useState<Record<number, "queue" | "schedule">>({});
  const [dueAt, setDueAt] = useState<Record<number, string>>({});
  const [postResult, setPostResult] = useState<Record<number, string>>({});

  async function refreshAccountsAndChannels() {
    try {
      const [chRes, acRes] = await Promise.all([
        fetch("/api/buffer/channels"),
        fetch("/api/accounts"),
      ]);
      const chData = await chRes.json();
      const acData = await acRes.json();
      if (Array.isArray(chData.accounts)) setAccountChannels(chData.accounts);
      if (Array.isArray(acData.accounts)) setSavedAccounts(acData.accounts);
    } catch {
      /* account/channel lists are optional at load time — surfaced when posting */
    }
  }

  async function refreshRenders() {
    try {
      const r = await fetch("/api/renders");
      const d = await r.json();
      if (Array.isArray(d.renders)) setExistingRenders(d.renders);
    } catch {
      /* renders list is optional at load time */
    }
  }

  useEffect(() => {
    refreshAccountsAndChannels();
    refreshRenders();
  }, []);

  // If a render for the CURRENT video already exists on disk (matched via the
  // render manifest by YouTube video id), surface it in the per-clip player
  // immediately — no re-render needed. The source match prevents a stale clip
  // from a DIFFERENT video from ever showing up or being posted here.
  useEffect(() => {
    if (!editPlan || existingRenders.length === 0) return;
    const currentId = ytId(intel?.sourceUrl);
    if (!currentId) return;
    const matching = new Set(
      existingRenders.filter((r) => ytId(r.sourceUrl) === currentId).map((r) => r.file)
    );
    if (matching.size === 0) return;
    setRenderedUrls((prev) => {
      const next = { ...prev };
      editPlan.clips.forEach((clip, i) => {
        const file = `${clip.clipId}.mp4`;
        if (!next[i] && matching.has(file)) next[i] = `/renders/${file}`;
      });
      return next;
    });
  }, [editPlan, intel, existingRenders]);

  function toggleTarget(clipIndex: number, key: string) {
    setSelectedTargets((prev) => ({
      ...prev,
      [clipIndex]: { ...(prev[clipIndex] ?? {}), [key]: !prev[clipIndex]?.[key] },
    }));
  }

  function selectedCount(clipIndex: number): number {
    return Object.values(selectedTargets[clipIndex] ?? {}).filter(Boolean).length;
  }

  // Platforms the coach should tailor captions for: those checked on the target
  // clip, or every connected platform as fallback.
  function coachPlatforms(clipIndex: number): string[] {
    const selected = new Set<string>();
    for (const a of accountChannels) {
      for (const c of a.channels) {
        if (selectedTargets[clipIndex]?.[`${a.account.id}:${c.id}`]) selected.add(c.service);
      }
    }
    if (selected.size > 0) return Array.from(selected);
    return accountChannels.flatMap((a) => a.channels.map((c) => c.service));
  }

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which clip the caption-coach suggestions get written into.
  const [coachTargetClip, setCoachTargetClip] = useState(0);
  // Setup diagnostics — env vars that must be configured for the pipeline to run.
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  // The AI's own system prompt — editable (advanced). Saved server-side; an
  // empty box falls back to the built-in concise default.
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setConfigStatus(d.status ?? null))
      .catch(() => {
        /* non-fatal */
      });
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((d) => d.systemPrompt && setSystemPrompt(d.systemPrompt))
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  // Every API call gets a hard client-side timeout so the UI can never spin
  // forever (the original "stuck on Fetching…" bug): analyze ~2.5min (Apify
  // actor run), plan ~2min (GLM), render 10min (download + Remotion render).
  async function callApi(url: string, body: any, timeoutMs = 120_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      return data;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(
          `The server did not respond within ${Math.round(timeoutMs / 1000)}s. ` +
            `Check the dev-server log, then try again — if this keeps happening ` +
            `the step may be failing on the server before it can reply.`
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleAnalyze() {
    setError(null);
    setLoading("analyze");
    try {
      const data = await callApi(
        "/api/analyze",
        { youtubeUrl, url: youtubeUrl },
        150_000
      );
      setIntel(data.intel);
      // Analyze is metadata-only — the actual video file downloads lazily at
      // render time. Tell the user so the render step's extra wait isn't a
      // surprise.
      setFilePending(Boolean(data.videoFilePending));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function handleStyleProfile() {
    if (!sampleFile) return;
    setError(null);
    setLoading("style");
    try {
      // Upload the reference clip as multipart form-data. Frames are extracted
      // locally with ffmpeg and read by the vision model — no Apify, no URL.
      const form = new FormData();
      form.append("file", sampleFile);
      const res = await fetch("/api/style-profile", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Style extraction failed");
      setStyleProfile(data.styleProfile);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function resetSystemPrompt() {
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: null }),
      });
      const d = await res.json();
      if (d.systemPrompt) setSystemPrompt(d.systemPrompt);
    } catch {
      /* non-fatal */
    }
  }

  async function handleGeneratePlan() {
    if (!intel) return;
    setError(null);
    setLoading("plan");
    try {
      const rules: EditRules = {
        instructions: rulesText,
        targetClipCount,
        minClipSec: minSec,
        maxClipSec: maxSec,
        aspect: "9:16",
      };
      const data = await callApi("/api/edit-plan", {
        intel,
        rules,
        styleProfile: styleProfile ?? undefined,
        systemPrompt,
      });
      setEditPlan(data.editPlan);
      setRenderedUrls({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function handleRender(clipIndex: number) {
    if (!editPlan) return;
    setError(null);
    setLoading(`render-${clipIndex}`);
    try {
      const data = await callApi(
        "/api/render",
        {
          editPlan,
          clipIndex,
          sourceUrl: intel?.sourceUrl ?? "",
        },
        600_000
      );
      setRenderedUrls((prev) => ({ ...prev, [clipIndex]: data.url }));
      refreshRenders();
      setCaption((prev) => ({
        ...prev,
        [clipIndex]: prev[clipIndex] ?? editPlan.clips[clipIndex].hookTitle,
      }));
      setPostMode((prev) => ({ ...prev, [clipIndex]: prev[clipIndex] ?? "queue" }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function handlePostToBuffer(clipIndex: number) {
    const renderedPath = renderedUrls[clipIndex];
    const mode = postMode[clipIndex] ?? "queue";
    const checks = selectedTargets[clipIndex] ?? {};
    const targets = Object.entries(checks)
      .filter(([, on]) => on)
      .map(([key]) => {
        const splitAt = key.indexOf(":");
        return {
          accountId: key.slice(0, splitAt),
          channelId: key.slice(splitAt + 1),
        };
      });
    if (!renderedPath || targets.length === 0) return;

    setError(null);
    setLoading(`post-${clipIndex}`);
    try {
      // One request fans out concurrently to EVERY selected channel across
      // EVERY selected Buffer account (see /api/buffer/post).
      const data: PostResponse = await callApi("/api/buffer/post", {
        renderedPath,
        targets,
        caption: caption[clipIndex] ?? "",
        mode,
        dueAtIso: mode === "schedule" ? new Date(dueAt[clipIndex]).toISOString() : undefined,
      });
      setPostResult((prev) => ({
        ...prev,
        [clipIndex]: `Queued on ${data.summary.succeeded}/${data.summary.total} channels${
          data.summary.failed > 0 ? ` · ${data.summary.failed} failed` : ""
        } ✓`,
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ color: ACCENT, fontSize: 12, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>
          LONG2SHORT
        </div>
        <h1 style={{ fontSize: 28, margin: 0, fontWeight: 700 }}>Long-form in. Short-form out.</h1>
        <p style={{ color: "#8A8D93", marginTop: 8, fontSize: 14 }}>
          Apify pulls the video + transcript. GLM plans the edit. Remotion renders it. Post to
          unlimited Buffer accounts simultaneously.
        </p>
      </div>

      {error && (
        <div style={{ ...stepStyle, borderColor: "#8C2E1F", background: "#20120D", color: "#FF9B7A" }}>
          {error}
        </div>
      )}

      {configStatus && configStatus.missing.length > 0 && (
        <div style={{ ...stepStyle, borderColor: "#8C2E1F", background: "#20120D", marginBottom: 20 }}>
          <span style={{ color: "#FF9B7A", fontWeight: 700, fontSize: 14, display: "block", marginBottom: 6 }}>
            Setup incomplete — {configStatus.missing.length} environment key{configStatus.missing.length === 1 ? "" : "s"} missing
          </span>
          <p style={{ fontSize: 13, color: "#E8E6E1", margin: "0 0 10px" }}>
            The pipeline can&apos;t run until these are in <code style={{ color: "#FF9B7A" }}>.env.local</code> (see{" "}
            <code style={{ color: "#FF9B7A" }}>.env.local.example</code>). You saw a 500 on “Analyze video” because
            step 1 needs the Apify keys.
          </p>
          <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            {configStatus.missing.map((m) => (
              <li key={m.key} style={{ color: "#E8E6E1" }}>
                <code style={{ color: "#FF9B7A" }}>{m.key}</code> — {m.label}. Get it at: {m.hint}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: "#8A8D93", margin: "10px 0 0" }}>
            After adding them to <code>.env.local</code>, restart the dev server (Ctrl+C, then <code>npm run dev</code>) and reload.
          </p>
        </div>
      )}

      {/* Multi-account Buffer management — add/remove API keys, see channels */}
      <AccountsManager accounts={accountChannels} onChanged={refreshAccountsAndChannels} />

      {/* Step 1: source video */}
      <section style={stepStyle}>
        <span style={labelStyle}>01 · Source video</span>
        <input
          style={inputStyle}
          placeholder="Video URL — YouTube, TikTok, Instagram, Facebook, X, Vimeo, direct mp4…"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
        />
        <div style={{ marginTop: 12 }}>
          <button
            style={loading === "analyze" || !youtubeUrl ? buttonDisabled : buttonStyle}
            disabled={loading === "analyze" || !youtubeUrl}
            onClick={handleAnalyze}
          >
            {loading === "analyze"
              ? "Fetching metadata… (usually 15–60s)"
              : "Analyze video"}
          </button>
        </div>
        {intel && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#8A8D93" }}>
            Loaded "{intel.title}" — {Math.round(intel.durationSec)}s, {intel.transcript.length} transcript words.
            {filePending && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#8A8D93" }}>
                ✔ Metadata loaded. The video file downloads automatically when you
                render a clip (first render for a video takes a few extra minutes
                because of the download; after that it's cached).
              </div>
            )}
          </div>
        )}
      </section>

      {/* Step 2: optional style sample — upload a reference clip (no Apify) */}
      <section style={stepStyle}>
        <span style={labelStyle}>02 · Reference editing style (optional)</span>
        <p style={{ fontSize: 13, color: "#8A8D93", margin: "0 0 12px" }}>
          Upload a short clip whose editing style you want copied. Frames are read
          locally with ffmpeg and analyzed by the vision model — no Apify, no URL.
        </p>
        <input
          type="file"
          accept="video/*"
          style={{ ...inputStyle, padding: 10 }}
          onChange={(e) => setSampleFile(e.target.files?.[0] ?? null)}
        />
        {sampleFile && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#8A8D93" }}>
            Selected: {sampleFile.name} ({(sampleFile.size / 1000000).toFixed(1)} MB)
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button
            style={loading === "style" || !sampleFile ? buttonDisabled : buttonStyle}
            disabled={loading === "style" || !sampleFile}
            onClick={handleStyleProfile}
          >
            {loading === "style" ? "Analyzing style…" : "Extract style profile"}
          </button>
        </div>
        {styleProfile && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#8A8D93" }}>
            Cut ~every {styleProfile.avgCutLengthSec}s · captions {styleProfile.captionStyle.wordsPerCaption}{" "}
            words/{styleProfile.captionStyle.position} · zoom every {styleProfile.zoomRhythm.zoomEverySec}s
          </div>
        )}
      </section>

      {/* Step 3: rules — editable every run */}
      <section style={stepStyle}>
        <span style={labelStyle}>03 · Editing rules (change these anytime)</span>
        <textarea
          style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
        />
        <div style={{ marginTop: 10 }}>
          <button
            style={{
              ...buttonStyle,
              background: "transparent",
              color: "#8A8D93",
              border: `1px solid ${BORDER}`,
              padding: "6px 12px",
              fontSize: 12,
            }}
            onClick={() => setShowSystemPrompt((v) => !v)}
          >
            {showSystemPrompt ? "Hide AI system prompt" : "Edit AI system prompt (advanced)"}
          </button>
        </div>
        {showSystemPrompt && (
          <div style={{ marginTop: 10 }}>
            <span style={labelStyle}>
              AI system prompt — how the model picks moments &amp; writes captions (saved
              automatically when you generate)
            </span>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 170,
                resize: "vertical",
                fontFamily: "monospace",
                fontSize: 12,
              }}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
            <button
              style={{
                ...buttonStyle,
                background: "transparent",
                color: "#8A8D93",
                border: `1px solid ${BORDER}`,
                padding: "6px 12px",
                fontSize: 12,
                marginTop: 8,
              }}
              onClick={resetSystemPrompt}
            >
              Reset to default
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <span style={labelStyle}># Clips</span>
            <input
              type="number"
              style={inputStyle}
              value={targetClipCount}
              onChange={(e) => setTargetClipCount(Number(e.target.value))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <span style={labelStyle}>Min sec</span>
            <input type="number" style={inputStyle} value={minSec} onChange={(e) => setMinSec(Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={labelStyle}>Max sec</span>
            <input type="number" style={inputStyle} value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            style={loading === "plan" || !intel ? buttonDisabled : buttonStyle}
            disabled={loading === "plan" || !intel}
            onClick={handleGeneratePlan}
          >
            {loading === "plan" ? "GLM is planning the edit…" : "Generate edit plan"}
          </button>
        </div>
      </section>

      {/* Watch-before-post: clips already rendered on this machine */}
      {existingRenders.length > 0 && (
        <section style={stepStyle}>
          <span style={labelStyle}>Rendered clips on this machine — watch before posting</span>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
            {existingRenders.map((r) => (
              <div key={r.file}>
                <video
                  src={r.url}
                  controls
                  preload="metadata"
                  style={{ display: "block", width: 220, borderRadius: 8 }}
                />
                <div style={{ fontSize: 12, color: "#8A8D93", marginTop: 6 }}>
                  {r.hookTitle || r.file} · {r.sizeMb} MB
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#8A8D93", marginBottom: 0 }}>
            Preview only — nothing is uploaded anywhere from this section. Posting happens
            only through the “Post via Buffer” controls, which stay locked until a clip is
            rendered for the current video.
          </p>
        </section>
      )}

      {/* Step 4: clips + render */}
      {editPlan && (
        <section style={stepStyle}>
          <span style={labelStyle}>04 · Clips</span>
          {editPlan.clips.map((clip, i) => (
            <div
              key={clip.clipId}
              style={{ borderTop: i === 0 ? "none" : `1px solid ${BORDER}`, padding: "16px 0" }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{clip.hookTitle}</div>
              <div style={{ fontSize: 13, color: "#8A8D93", marginBottom: 10 }}>
                {clip.sourceStartSec.toFixed(1)}s → {clip.sourceEndSec.toFixed(1)}s ·{" "}
                {(clip.sourceEndSec - clip.sourceStartSec).toFixed(1)}s clip
              </div>
              <button
                style={loading === `render-${i}` ? buttonDisabled : buttonStyle}
                disabled={loading === `render-${i}`}
                onClick={() => handleRender(i)}
              >
                {loading === `render-${i}`
                  ? "Downloading source + rendering… (3–8 min, don't close)"
                  : "Render clip"}
              </button>
              {renderedUrls[i] && (
                <>
                  <video
                    src={renderedUrls[i]}
                    controls
                    style={{ display: "block", marginTop: 12, width: 220, borderRadius: 8 }}
                  />

                  <div style={{ marginTop: 16, borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
                    <span style={labelStyle}>Post via Buffer · pick any channels across accounts</span>

                    {accountChannels.length === 0 ? (
                      <p style={{ fontSize: 13, color: "#8A8D93", margin: "0 0 10px" }}>
                        No Buffer accounts configured — add one in the “Buffer accounts” panel above.
                      </p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                        {accountChannels.map(({ account, channels: accChannels, error: chErr }) => (
                          <div key={account.id}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#8A8D93", marginBottom: 6 }}>
                              {account.name}
                              {chErr ? ` · ${chErr}` : ""}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {accChannels.length === 0 && !chErr && (
                                <span style={{ fontSize: 12, color: "#8A8D93" }}>No channels connected.</span>
                              )}
                              {accChannels.map((c) => {
                                const key = `${account.id}:${c.id}`;
                                const checked = selectedTargets[i]?.[key] ?? false;
                                return (
                                  <label key={key} style={chipStyle(checked)}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleTarget(i, key)}
                                      style={{ marginRight: 6, accentColor: ACCENT }}
                                    />
                                    {c.displayName} ({c.service})
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      style={{ ...inputStyle, minHeight: 60, resize: "vertical", marginBottom: 10 }}
                      placeholder="Caption (applied to all selected channels unless overridden per target later)"
                      value={caption[i] ?? ""}
                      onChange={(e) => setCaption((prev) => ({ ...prev, [i]: e.target.value }))}
                    />

                    <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                      <select
                        style={inputStyle}
                        value={postMode[i] ?? "queue"}
                        onChange={(e) =>
                          setPostMode((prev) => ({ ...prev, [i]: e.target.value as "queue" | "schedule" }))
                        }
                      >
                        <option value="queue">Add to queue (next open slot)</option>
                        <option value="schedule">Schedule for a specific time</option>
                      </select>
                      {postMode[i] === "schedule" && (
                        <input
                          type="datetime-local"
                          style={inputStyle}
                          value={dueAt[i] ?? ""}
                          onChange={(e) => setDueAt((prev) => ({ ...prev, [i]: e.target.value }))}
                        />
                      )}
                    </div>

                    <button
                      style={
                        loading === `post-${i}` || renderedUrls[i] === undefined || selectedCount(i) === 0
                          ? buttonDisabled
                          : buttonStyle
                      }
                      disabled={loading === `post-${i}` || selectedCount(i) === 0}
                      onClick={() => handlePostToBuffer(i)}
                    >
                      {loading === `post-${i}`
                        ? "Posting everywhere…"
                        : `Post to ${selectedCount(i)} channel${selectedCount(i) === 1 ? "" : "s"} simultaneously`}
                    </button>
                    {postResult[i] && (
                      <span style={{ marginLeft: 12, fontSize: 13, color: "#8A8D93" }}>{postResult[i]}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Caption coach — Apify web research + GLM rewriting per platform */}
      {editPlan && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={labelStyle}>Apply coached captions to</span>
            <select
              style={{ ...inputStyle, width: 200 }}
              value={coachTargetClip}
              onChange={(e) => setCoachTargetClip(Number(e.target.value))}
            >
              {editPlan.clips.map((_, idx) => (
                <option key={idx} value={idx}>
                  Clip #{idx + 1}
                </option>
              ))}
            </select>
          </div>
          <CaptionCoach
            platforms={coachPlatforms(coachTargetClip)}
            draftCaption={caption[coachTargetClip] ?? ""}
            onApplyCaption={(c) => setCaption((prev) => ({ ...prev, [coachTargetClip]: c }))}
          />
        </>
      )}

      {/* Per-account Buffer analytics + AI growth advice */}
      <AnalyticsPanel accounts={savedAccounts} />

      {/* Floating chat assistant — propose-only until you Confirm */}
      <ChatPanel />
    </main>
  );
}
