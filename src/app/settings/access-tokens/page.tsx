"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyButton, Msg } from "@/app/components";
import { api, errText, fmtDate } from "@/app/lib";

interface AccessTokenRow {
  id: string;
  label: string;
  scopes: string[];
  clientType: "mcp" | "api" | "extension";
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const DEFAULT_SCOPES = [
  "utm:read",
  "utm:preview",
  "utm:issue",
  "utm:campaigns:write",
  "utm:initiatives:write",
  "gtm:read",
  "gtm:templates",
];

export default function AccessTokensPage() {
  const [tokens, setTokens] = useState<AccessTokenRow[]>([]);
  const [label, setLabel] = useState("My GTM Data integration");
  const [clientType, setClientType] = useState<"mcp" | "api">("mcp");
  const [days, setDays] = useState(30);
  const [createdToken, setCreatedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const result = await api<{ tokens: AccessTokenRow[] }>("/api/v1/access-tokens");
    setTokens(result.tokens);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(errText(err)));
  }, [load]);

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    setCreatedToken("");
    try {
      const result = await api<{ token: string }>("/api/v1/access-tokens", {
        method: "POST",
        body: JSON.stringify({
          label,
          clientType,
          expiresInDays: days,
          scopes: DEFAULT_SCOPES,
        }),
      });
      setCreatedToken(result.token);
      setSuccess("Access token created. Copy it now; it will not be shown again.");
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this access token? Clients using it will stop working immediately.")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/access-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setSuccess("Access token revoked.");
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>API access</h1>
      <p className="page-sub">
        Create personal tokens for the Runpod GTM Data MCP or another approved integration. New tokens include the GTM catalog/template scopes and UTM module scopes. Browser-extension tokens are issued automatically through SSO and expire after eight hours.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{success}</Msg>

      {createdToken ? (
        <section className="card" aria-live="polite">
          <h2>Copy this token now</h2>
          <p className="hint">The registry stores only a cryptographic hash, so this value cannot be retrieved later.</p>
          <div className="field-row">
            <div className="field" style={{ flex: 4 }}>
              <label htmlFor="new-token">Access token</label>
              <input id="new-token" type="text" className="mono" readOnly value={createdToken} />
            </div>
            <div className="field" style={{ alignSelf: "end" }}>
              <CopyButton text={createdToken} label="Copy token" />
            </div>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Create access token</h2>
        <form onSubmit={(event) => void createToken(event)}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="token-label">Label</label>
              <input id="token-label" type="text" required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="client-type">Use</label>
              <select id="client-type" value={clientType} onChange={(event) => setClientType(event.target.value as "mcp" | "api")}>
                <option value="mcp">MCP client</option>
                <option value="api">Direct API</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="expires-days">Expires after</label>
              <select id="expires-days" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
            </div>
          </div>
          <p className="hint">Tokens are user-scoped, expire automatically, can be revoked here, and every write remains attributed in the audit log.</p>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create token"}</button>
        </form>
      </section>

      <section className="card">
        <h2>Existing tokens</h2>
        {tokens.length === 0 ? <p className="muted">No access tokens yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Label</th><th>Use</th><th>Created</th><th>Expires</th><th>Last used</th><th>Status</th><th /></tr></thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td><strong>{token.label}</strong><br /><span className="mono small">{token.id}</span></td>
                    <td>{token.clientType}</td>
                    <td>{fmtDate(token.createdAt)}</td>
                    <td>{fmtDate(token.expiresAt)}</td>
                    <td>{token.lastUsedAt ? fmtDate(token.lastUsedAt) : "Never"}</td>
                    <td>{token.revokedAt ? "Revoked" : new Date(token.expiresAt) <= new Date() ? "Expired" : "Active"}</td>
                    <td>{token.revokedAt ? null : <button type="button" className="btn-small btn-danger" disabled={busy} onClick={() => void revoke(token.id)}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
