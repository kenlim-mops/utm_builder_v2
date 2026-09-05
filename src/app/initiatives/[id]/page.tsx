"use client";

/** Initiative detail: metadata, campaigns, links, export. */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, CopyButton, Msg, useSession } from "../../components";
import {
  api,
  errText,
  fmtDate,
  fmtDateTime,
  type Campaign,
  type Initiative,
  type LinkRec,
  type UserRec,
} from "../../lib";

interface InitiativeDetail {
  initiative: Initiative;
  campaigns: Campaign[];
  links: LinkRec[];
  permissions: { canManage: boolean; canTransferOwnership: boolean };
}

export default function InitiativeDetailPage() {
  const { capabilities } = useSession();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [detail, setDetail] = useState<InitiativeDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserRec[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [ownerReason, setOwnerReason] = useState("");
  const [savingOwner, setSavingOwner] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [d, u] = await Promise.all([
          api<InitiativeDetail>(`/api/initiatives/${id}`),
          capabilities.canAdminister
            ? api<{ users: UserRec[] }>("/api/admin/users")
            : Promise.resolve({ users: [] }),
        ]);
        if (!cancelled) {
          setDetail(d);
          setUsers(u.users.filter((user) => user.active && user.role !== "investigator"));
          setOwnerId(d.initiative.ownerId ?? "");
        }
      } catch (err) {
        if (!cancelled) setError(errText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, capabilities.canAdminister]);

  async function transferOwnership() {
    if (!ownerId || !ownerReason.trim()) return;
    setSavingOwner(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ initiative: Initiative }>(`/api/initiatives/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerId, reason: ownerReason.trim() }),
      });
      setDetail((current) => current ? { ...current, initiative: result.initiative } : current);
      setOwnerReason("");
      setNotice("Initiative ownership updated and recorded in the audit log.");
    } catch (err) {
      setError(errText(err));
    } finally {
      setSavingOwner(false);
    }
  }

  if (loading) return <p aria-live="polite">Loading initiative…</p>;
  if (error && !detail) return <Msg kind="error">{error}</Msg>;
  if (!detail) return null;

  const { initiative, campaigns, links } = detail;

  return (
    <div>
      <h1>{initiative.name}</h1>
      <p className="page-sub">
        <span className="mono">{initiative.id}</span> <Badge value={initiative.lifecycle} />
      </p>
      <Msg kind="success">{notice}</Msg>
      <Msg kind="error">{error}</Msg>

      <div className="card">
        <h2>Metadata</h2>
        <div className="table-wrap">
          <table className="kv-table">
            <tbody>
              <tr>
                <th scope="row">Product</th>
                <td>{initiative.product ?? <span className="muted">—</span>}</td>
              </tr>
              <tr>
                <th scope="row">Type</th>
                <td>{initiative.initiativeType ?? <span className="muted">—</span>}</td>
              </tr>
              <tr>
                <th scope="row">Start</th>
                <td>{fmtDate(initiative.startDate)}</td>
              </tr>
              <tr>
                <th scope="row">End</th>
                <td>{fmtDate(initiative.endDate)}</td>
              </tr>
              <tr>
                <th scope="row">Description</th>
                <td>{initiative.description ?? <span className="muted">—</span>}</td>
              </tr>
              <tr>
                <th scope="row">Owner</th>
                <td>{users.find((user) => user.id === initiative.ownerId)?.email ?? initiative.ownerId ?? <span className="muted">Unassigned</span>}</td>
              </tr>
              <tr>
                <th scope="row">Created</th>
                <td>{fmtDateTime(initiative.createdAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <a className="btn" href={`/api/export/links?initiativeId=${encodeURIComponent(initiative.id)}`}>
            Export links CSV
          </a>
          <Link className="btn" href={`/registry?initiativeId=${encodeURIComponent(initiative.id)}`}>
            View in registry
          </Link>
        </div>
        {detail.permissions.canTransferOwnership ? (
          <div className="inline-form">
            <h3>Transfer ownership</h3>
            <div className="field-row">
              <div className="field">
                <label htmlFor="initiative-owner">New owner</label>
                <select id="initiative-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                  <option value="">Select an active owner…</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="initiative-owner-reason">Reason (required and audited)</label>
                <input id="initiative-owner-reason" value={ownerReason} onChange={(event) => setOwnerReason(event.target.value)} />
              </div>
            </div>
            <button type="button" disabled={savingOwner || !ownerId || !ownerReason.trim() || ownerId === initiative.ownerId} onClick={() => void transferOwnership()}>
              {savingOwner ? "Saving…" : "Transfer ownership"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Campaigns ({campaigns.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>utm_campaign</th>
                <th>ID (utm_id)</th>
                <th>Lifecycle</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/campaigns/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="mono small">{c.utmCampaign}</td>
                  <td className="mono small">{c.id}</td>
                  <td>
                    <Badge value={c.lifecycle} />
                  </td>
                  <td className="nowrap small">{fmtDateTime(c.createdAt)}</td>
                </tr>
              ))}
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No campaigns attached to this initiative.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Links ({links.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Final URL</th>
                <th>Source / Medium</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/registry/links/${l.id}`} className="url-cell mono small" title={l.finalUrl}>
                      {l.finalUrl}
                    </Link>{" "}
                    <CopyButton text={l.finalUrl} />
                  </td>
                  <td className="nowrap mono small">
                    {l.utmSource} / {l.utmMedium}
                  </td>
                  <td>
                    <Badge value={l.status} />
                  </td>
                  <td className="nowrap small">{fmtDateTime(l.createdAt)}</td>
                </tr>
              ))}
              {links.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No links issued under this initiative yet.
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
