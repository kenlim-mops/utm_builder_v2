"use client";

/**
 * Audit log (admin + investigator): searchable, paginated, with expandable
 * before/after JSON and CSV export of the current filters.
 */
import { useCallback, useEffect, useState } from "react";
import { JsonDetails, Msg, Pager } from "../../components";
import { api, errText, fmtDateTime, qs, type AuditEvent } from "../../lib";

interface AuditFilters {
  q: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
  after: string;
  before: string;
}

const EMPTY: AuditFilters = {
  q: "",
  action: "",
  entityType: "",
  entityId: "",
  actor: "",
  after: "",
  before: "",
};

export default function AdminAuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = qs({
    q: filters.q,
    action: filters.action,
    entityType: filters.entityType,
    entityId: filters.entityId,
    actor: filters.actor,
    after: filters.after,
    before: filters.before,
    page,
    pageSize: 50,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const d = await api<{ events: AuditEvent[]; total: number }>(`/api/admin/audit${query}`);
        if (!cancelled) {
          setEvents(d.events);
          setTotal(d.total);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(errText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const setFilter = useCallback((key: keyof AuditFilters, value: string) => {
    setFilters((cur) => ({ ...cur, [key]: value }));
    setPage(1);
  }, []);

  const csvQuery = qs({
    q: filters.q,
    action: filters.action,
    entityType: filters.entityType,
    entityId: filters.entityId,
    actor: filters.actor,
    after: filters.after,
    before: filters.before,
    format: "csv",
  });

  return (
    <div>
      <h1>Audit log</h1>
      <p className="page-sub">
        Append-only record of every material action. Readable by admins and investigators.
      </p>

      <div className="card">
        <div className="filters">
          <div>
            <label htmlFor="a-q">Text (action / entity ID)</label>
            <input id="a-q" type="text" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
          </div>
          <div>
            <label htmlFor="a-action">Action (exact)</label>
            <input
              id="a-action"
              type="text"
              placeholder="link.issued"
              value={filters.action}
              onChange={(e) => setFilter("action", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="a-entity-type">Entity type</label>
            <input
              id="a-entity-type"
              type="text"
              placeholder="link, campaign, setting…"
              value={filters.entityType}
              onChange={(e) => setFilter("entityType", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="a-entity-id">Entity ID</label>
            <input
              id="a-entity-id"
              type="text"
              placeholder="rpl_…"
              value={filters.entityId}
              onChange={(e) => setFilter("entityId", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="a-actor">Actor (ID or email)</label>
            <input
              id="a-actor"
              type="text"
              value={filters.actor}
              onChange={(e) => setFilter("actor", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="a-after">After</label>
            <input
              id="a-after"
              type="date"
              value={filters.after}
              onChange={(e) => setFilter("after", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="a-before">Before</label>
            <input
              id="a-before"
              type="date"
              value={filters.before}
              onChange={(e) => setFilter("before", e.target.value)}
            />
          </div>
        </div>
        <div className="btn-row">
          <button type="button" onClick={() => { setFilters(EMPTY); setPage(1); }}>
            Clear filters
          </button>
          <a className="btn" href={`/api/admin/audit${csvQuery}`}>
            Export CSV (current filters)
          </a>
          {loading ? <span className="hint" aria-live="polite">Searching…</span> : null}
        </div>
      </div>

      <Msg kind="error">{error}</Msg>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="nowrap">When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Reason</th>
              <th>Before / After</th>
              <th>Config</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="nowrap small">{fmtDateTime(e.ts)}</td>
                <td className="mono small">{e.actorEmail}</td>
                <td className="mono small">{e.action}</td>
                <td className="mono small">
                  {e.entityType} / {e.entityId}
                </td>
                <td>{e.reason ?? <span className="muted">—</span>}</td>
                <td>
                  <JsonDetails label="Before" value={e.before} />
                  <JsonDetails label="After" value={e.after} />
                  {e.context !== null && e.context !== undefined ? (
                    <JsonDetails label="Context" value={e.context} />
                  ) : null}
                </td>
                <td className="small">{e.configVersion === null ? "—" : `v${e.configVersion}`}</td>
              </tr>
            ))}
            {!loading && events.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No audit events match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageSize={50} total={total} onPage={setPage} />
    </div>
  );
}
