"use client";

// Analytics panel UI: pick one of your saved Buffer accounts, pull its real
// engagement numbers through /api/buffer/analytics, and get per-channel AI
// advice on how to post for more views.

import React, { useState } from "react";
import type { PublicAccount } from "../../lib/clientTypes";
import {
  stepStyle,
  labelStyle,
  inputStyle,
  buttonStyle,
  buttonDisabled,
  cardStyle,
  TEXT_MUTED,
  BAD,
} from "./ui";

interface AnalyticsChannel {
  channelId: string;
  service: string;
  displayName: string;
  posts: Array<{
    id: string;
    text: string;
    createdAt?: string;
    metrics: Record<string, number>;
  }>;
  error?: string;
}

interface AnalyticsAdvice {
  overall?: string;
  perChannel?: Array<{ channel: string; bestPerforming?: string; advice: string[] }>;
}

interface AnalyticsResponse {
  account: PublicAccount;
  source: "graphql" | "rest" | "none";
  warning?: string;
  channels: AnalyticsChannel[];
  advice?: AnalyticsAdvice;
}

interface Props {
  accounts: PublicAccount[];
}

export default function AnalyticsPanel({ accounts }: Props) {
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/buffer/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load analytics");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={stepStyle}>
      <span style={labelStyle}>Analytics &amp; growth advice · per Buffer account</span>
      <p style={{ fontSize: 13, color: TEXT_MUTED, margin: "0 0 12px" }}>
        Pulls recent post performance for one account&apos;s channels, then AI explains what
        your best posts have in common and exactly how to get more views on that account.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select
          style={{ ...inputStyle, flex: "1 1 260px" }}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="" disabled>
            {accounts.length ? "Choose an account…" : "No accounts configured"}
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          style={loading || !accountId ? buttonDisabled : buttonStyle}
          disabled={loading || !accountId}
          onClick={load}
        >
          {loading ? "Analyzing…" : "Get analytics + advice"}
        </button>
      </div>

      {error && <div style={{ marginTop: 10, color: BAD, fontSize: 13 }}>{error}</div>}

      {data?.warning && (
        <div style={{ marginTop: 10, color: "#E8B341", fontSize: 12 }}>{data.warning}</div>
      )}

      {data && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.channels.map((ch, chIdx) => {
            const totals = ch.posts.reduce<Record<string, number>>((acc, p) => {
              for (const [k, v] of Object.entries(p.metrics)) acc[k] = (acc[k] ?? 0) + v;
              return acc;
            }, {});
            const name = (ch.displayName ?? "").toLowerCase();
            const adviceFor =
              data.advice?.perChannel?.find((p) => {
                const label = (p.channel ?? "").toLowerCase();
                return (
                  (name.length > 0 && label.includes(name)) ||
                  (label.length > 0 && name.includes(label)) ||
                  (ch.service ? label.includes(ch.service.toLowerCase()) : false)
                );
              }) ?? data.advice?.perChannel?.[chIdx];

            return (
              <div key={ch.channelId || ch.displayName} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 13 }}>
                    {ch.displayName}{" "}
                    <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>({ch.service})</span>
                  </strong>
                  <span style={{ fontSize: 11, color: TEXT_MUTED }}>
                    {ch.posts.length} recent post{ch.posts.length === 1 ? "" : "s"}
                  </span>
                </div>

                {Object.keys(totals).length > 0 ? (
                  <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                    {Object.entries(totals)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([k, v]) => (
                        <span key={k} style={{ fontSize: 12 }}>
                          <span style={{ color: TEXT_MUTED }}>{k}: </span>
                          <strong>{v.toLocaleString()}</strong>
                        </span>
                      ))}
                  </div>
                ) : (
                  !ch.error && (
                    <div style={{ marginTop: 6, fontSize: 12, color: TEXT_MUTED }}>
                      No engagement numbers available for this channel yet.
                    </div>
                  )
                )}
                {ch.error && (
                  <div style={{ marginTop: 6, fontSize: 12, color: BAD }}>Stats error: {ch.error}</div>
                )}

                {adviceFor?.advice?.length ? (
                  <div style={{ borderTop: "1px solid #2A2D31", marginTop: 10, paddingTop: 10 }}>
                    <span style={labelStyle}>AI advice</span>
                    {adviceFor.bestPerforming && (
                      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 6 }}>
                        Top performer: {adviceFor.bestPerforming}
                      </div>
                    )}
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {adviceFor.advice.map((a, i) => (
                        <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}

          {data.advice?.overall && (
            <div style={cardStyle}>
              <span style={labelStyle}>Overall strategy</span>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{data.advice.overall}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

