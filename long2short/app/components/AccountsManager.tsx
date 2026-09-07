"use client";

// Accounts manager UI: add / remove MULTIPLE Buffer accounts (each = one
// personal API key; the organization ID is auto-detected from the token) and
// see their connected channels at a glance. Tokens are masked by the server
// before they ever reach this component.

import React, { useEffect, useState } from "react";
import type { PublicAccount, AccountChannels } from "../../lib/clientTypes";
import {
  stepStyle,
  labelStyle,
  inputStyle,
  buttonStyle,
  buttonDisabled,
  ghostButtonStyle,
  cardStyle,
  BORDER,
  TEXT_MUTED,
  BAD,
} from "./ui";

interface Props {
  accounts: AccountChannels[];
  onChanged: () => void;
}

export default function AccountsManager({ accounts, onChanged }: Props) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [orgId, setOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);

  // The server knows whether storage is persistent (it isn't on Vercel —
  // /tmp only). Pick up its note on mount and whenever the list refreshes.
  useEffect(() => {
    let alive = true;
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.storageNote) setStorageNote(d.storageNote);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accounts.length]);

  async function handleAdd() {
    if (!name.trim() || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, accessToken: token, organizationId: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add account");
      if (data.storageNote) setStorageNote(data.storageNote);
      setName("");
      setToken("");
      setOrgId("");
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`Remove "${name}"? Saved posts already queued in Buffer are unaffected.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove account");
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={stepStyle}>
      <span style={labelStyle}>Buffer accounts</span>
      <p style={{ fontSize: 13, color: TEXT_MUTED, margin: "0 0 14px" }}>
        Add as many Buffer accounts as you like (create a personal API key per account
        at buffer.com &rarr; Settings &rarr; API). Every saved account&apos;s channels can
        receive posts simultaneously. Dead tokens are rejected the moment you add them.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          style={{ ...inputStyle, flex: "1 1 160px" }}
          placeholder="Account name (e.g. Brand #1)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          style={{ ...inputStyle, flex: "1 1 240px" }}
          placeholder="Access token (buffer.com → Settings → API)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <input
          style={{ ...inputStyle, flex: "1 1 180px" }}
          placeholder="Organization ID (auto-detected)"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
        />
        <button
          style={busy || !name || !token ? buttonDisabled : buttonStyle}
          disabled={busy || !name || !token}
          onClick={handleAdd}
        >
          {busy ? "Saving…" : "+ Add account"}
        </button>
      </div>

      <p style={{ fontSize: 12, color: TEXT_MUTED, margin: "8px 0 0" }}>
        Name + access token is all you need — long2short asks Buffer for your
        organization automatically. Only type the Organization ID manually if
        your token reaches multiple Buffer organizations.
      </p>

      {storageNote && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.45,
            color: "#92400e",
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 8,
          }}
        >
          {storageNote}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, color: BAD, fontSize: 13 }}>{error}</div>
      )}

      {accounts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {accounts.map(({ account, channels, error: channelError }) => (
            <div key={account.id} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{account.name}</div>
                  <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>
                    Token {account.tokenMask}
                    {account.organizationId ? ` · Org ${account.organizationId}` : ""}
                  </div>
                </div>
                <button style={ghostButtonStyle} onClick={() => handleRemove(account.id, account.name)}>
                  Remove
                </button>
              </div>

              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 10, paddingTop: 10 }}>
                {channelError ? (
                  <span style={{ fontSize: 12, color: BAD }}>Couldn&apos;t load channels: {channelError}</span>
                ) : channels.length === 0 ? (
                  <span style={{ fontSize: 12, color: TEXT_MUTED }}>No connected channels in this Buffer account.</span>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {channels.map((c) => (
                      <span
                        key={c.id}
                        style={{
                          fontSize: 11,
                          padding: "3px 9px",
                          borderRadius: 999,
                          border: `1px solid ${BORDER}`,
                          color: TEXT_MUTED,
                        }}
                      >
                        {c.displayName} · {c.service}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}