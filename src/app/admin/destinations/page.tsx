"use client";

/** Admin: destination domain policies (approved domains + exceptions). */
import { useCallback, useEffect, useState } from "react";
import { Badge, Msg } from "../../components";
import { api, errText, fmtDateTime, type DestinationPolicy } from "../../lib";

export default function AdminDestinationsPage() {
  const [policies, setPolicies] = useState<DestinationPolicy[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<"approved" | "exception">("approved");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ policies: DestinationPolicy[] }>("/api/admin/destinations");
      setPolicies(d.policies);
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>, savingKey: string, successMsg: string) => {
      setSaving(savingKey);
      setError("");
      setNotice("");
      try {
        await api("/api/admin/destinations", {
          method: "POST",
          body: JSON.stringify({ ...payload, reason: reason.trim() || undefined }),
        });
        setNotice(successMsg);
        await load();
      } catch (err) {
        setError(errText(err));
      } finally {
        setSaving("");
      }
    },
    [reason, load],
  );

  return (
    <div>
      <h1>Destination policies</h1>
      <p className="page-sub">
        Links may only point at approved domains; exceptions are explicit and audited.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <h2>Add policy</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="dp-domain">Domain</label>
            <input
              id="dp-domain"
              type="text"
              placeholder="runpod.io"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="dp-kind">Kind</label>
            <select
              id="dp-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as "approved" | "exception")}
            >
              <option value="approved">approved</option>
              <option value="exception">exception</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="dp-notes">Notes</label>
            <input id="dp-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dp-reason">Reason</label>
            <input id="dp-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!domain.trim() || saving === "new"}
          onClick={() => {
            void post(
              { domain: domain.trim().toLowerCase(), kind, notes: notes.trim() || undefined },
              "new",
              `Policy for "${domain}" saved.`,
            ).then(() => {
              setDomain("");
              setNotes("");
            });
          }}
        >
          {saving === "new" ? "Saving…" : "Add policy"}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.domain}</td>
                <td>
                  <Badge value={p.kind} />
                </td>
                <td>
                  <Badge value={p.status} />
                </td>
                <td>{p.notes ?? <span className="muted">—</span>}</td>
                <td className="nowrap small">{fmtDateTime(p.updatedAt)}</td>
                <td className="nowrap">
                  <button
                    type="button"
                    className="btn-small"
                    disabled={saving === p.id}
                    onClick={() =>
                      void post(
                        {
                          domain: p.domain,
                          kind: p.kind,
                          status: p.status === "active" ? "disabled" : "active",
                        },
                        p.id,
                        `Policy for "${p.domain}" ${p.status === "active" ? "disabled" : "enabled"}.`,
                      )
                    }
                  >
                    {saving === p.id ? "Saving…" : p.status === "active" ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
            {policies.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No destination policies configured.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
