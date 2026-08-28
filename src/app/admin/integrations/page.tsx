"use client";

/**
 * Admin: integrations health — outbox queue (retry/process) and registry
 * reconciliation runs.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, JsonDetails, Msg } from "../../components";
import {
  api,
  errText,
  fmtDateTime,
  type Discrepancy,
  type OutboxEvent,
  type ReconciliationRun,
} from "../../lib";

export default function AdminIntegrationsPage() {
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([
        api<{ events: OutboxEvent[] }>("/api/admin/outbox"),
        api<{ runs: ReconciliationRun[] }>("/api/admin/reconcile"),
      ]);
      setEvents(o.events);
      setRuns(r.runs);
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(
    async (eventId: string) => {
      setBusy(eventId);
      setError("");
      setNotice("");
      try {
        await api("/api/admin/outbox", {
          method: "POST",
          body: JSON.stringify({ action: "retry", eventId }),
        });
        setNotice(`Retry requested for ${eventId}; due events processed.`);
        await load();
      } catch (err) {
        setError(errText(err));
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const processDue = useCallback(async () => {
    setBusy("process");
    setError("");
    setNotice("");
    try {
      await api("/api/admin/outbox", { method: "POST", body: JSON.stringify({}) });
      setNotice("Due outbox events processed.");
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy("");
    }
  }, [load]);

  const runReconciliation = useCallback(async () => {
    setBusy("reconcile");
    setError("");
    setNotice("");
    setDiscrepancies(null);
    try {
      const d = await api<{ run: ReconciliationRun; discrepancies: Discrepancy[] }>(
        "/api/admin/reconcile",
        { method: "POST", body: JSON.stringify({}) },
      );
      setDiscrepancies(d.discrepancies);
      setNotice(
        `Reconciliation ${d.run.id} completed with ${d.discrepancies.length} discrepancy${d.discrepancies.length === 1 ? "" : "ies"}.`,
      );
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy("");
    }
  }, [load]);

  return (
    <div>
      <h1>Integrations</h1>
      <p className="page-sub">
        Async sync to HubSpot and the warehouse runs through the outbox — registry writes never
        depend on external systems.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <h2>Outbox events</h2>
        <div className="btn-row" style={{ marginTop: 0, marginBottom: "0.6rem" }}>
          <button type="button" disabled={busy !== ""} onClick={() => void processDue()}>
            {busy === "process" ? "Processing…" : "Process due now"}
          </button>
          <button type="button" disabled={busy !== ""} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Next attempt</th>
                <th>Last error</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="mono small">{e.type}</span>
                    <div className="small muted mono">{e.idempotencyKey}</div>
                  </td>
                  <td>
                    <Badge value={e.status} />
                  </td>
                  <td className="nowrap">
                    {e.attempts} / {e.maxAttempts}
                  </td>
                  <td className="nowrap small">{fmtDateTime(e.nextAttemptAt)}</td>
                  <td>
                    {e.lastError ? (
                      <span className="small" style={{ color: "var(--err)" }}>
                        {e.lastError}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="nowrap small">{fmtDateTime(e.createdAt)}</td>
                  <td>
                    {e.status === "failed" || e.status === "dead" ? (
                      <button
                        type="button"
                        className="btn-small"
                        disabled={busy !== ""}
                        onClick={() => void retry(e.id)}
                      >
                        {busy === e.id ? "Retrying…" : "Retry"}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Outbox is empty.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Reconciliation</h2>
        <div className="btn-row" style={{ marginTop: 0, marginBottom: "0.6rem" }}>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== ""}
            onClick={() => void runReconciliation()}
          >
            {busy === "reconcile" ? "Running…" : "Run reconciliation now"}
          </button>
        </div>

        {discrepancies !== null ? (
          <>
            <h3>Discrepancies from latest run ({discrepancies.length})</h3>
            {discrepancies.length === 0 ? (
              <Msg kind="success">No discrepancies found.</Msg>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Entity</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discrepancies.map((d, i) => (
                      <tr key={i}>
                        <td>
                          <Badge value="warning">{d.kind}</Badge>
                        </td>
                        <td className="mono small">
                          {d.entityType} / {d.entityId}
                        </td>
                        <td>{d.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        <h3>Recent runs</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Kind</th>
                <th>Triggered by</th>
                <th>Discrepancies</th>
                <th>When</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{r.id}</td>
                  <td>{r.kind}</td>
                  <td className="mono small">{r.triggeredBy}</td>
                  <td>
                    <Badge value={r.discrepancyCount > 0 ? "warning" : "passed"}>
                      {String(r.discrepancyCount)}
                    </Badge>
                  </td>
                  <td className="nowrap small">{fmtDateTime(r.createdAt)}</td>
                  <td>
                    <JsonDetails label="View result" value={r.result} />
                  </td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No reconciliation runs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
