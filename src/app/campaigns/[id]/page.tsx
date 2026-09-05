"use client";

/**
 * Campaign detail: metadata (utm_id = campaign ID, shown prominently),
 * HubSpot mapping sync state, and related links from the registry.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, CopyButton, Msg, useSession } from "../../components";
import {
  api,
  errText,
  fmtDate,
  fmtDateTime,
  qs,
  type Campaign,
  type CampaignMapping,
  type LinkSearchResult,
  type UserRec,
} from "../../lib";

interface CampaignDetail {
  campaign: Campaign;
  mappings: CampaignMapping[];
  permissions: { canManage: boolean; canTransferOwnership: boolean };
}

export default function CampaignDetailPage() {
  const { capabilities } = useSession();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [links, setLinks] = useState<LinkSearchResult | null>(null);
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
        const [d, l, u] = await Promise.all([
          api<CampaignDetail>(`/api/campaigns/${id}`),
          api<LinkSearchResult>(`/api/links${qs({ campaignId: id, pageSize: 100 })}`),
          capabilities.canAdminister
            ? api<{ users: UserRec[] }>("/api/admin/users")
            : Promise.resolve({ users: [] }),
        ]);
        if (!cancelled) {
          setDetail(d);
          setLinks(l);
          setUsers(u.users.filter((user) => user.active && user.role !== "investigator"));
          setOwnerId(d.campaign.ownerId ?? "");
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
      const result = await api<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerId, reason: ownerReason.trim() }),
      });
      setDetail((current) => current ? { ...current, campaign: result.campaign } : current);
      setOwnerReason("");
      setNotice("Campaign ownership updated and recorded in the audit log.");
    } catch (err) {
      setError(errText(err));
    } finally {
      setSavingOwner(false);
    }
  }

  if (loading) return <p aria-live="polite">Loading campaign…</p>;
  if (error && !detail) return <Msg kind="error">{error}</Msg>;
  if (!detail) return null;

  const { campaign, mappings } = detail;

  return (
    <div>
      <h1>{campaign.name}</h1>
      <p className="page-sub">
        <Badge value={campaign.lifecycle} /> utm_campaign:{" "}
        <span className="mono">{campaign.utmCampaign}</span>
      </p>
      <Msg kind="success">{notice}</Msg>
      <Msg kind="error">{error}</Msg>

      <div className="card">
        <h2>utm_id (campaign ID)</h2>
        <div className="final-url mono">{campaign.id}</div>
        <div className="btn-row">
          <CopyButton text={campaign.id} label="Copy utm_id" />
        </div>
        <p className="hint">
          This immutable ID is carried publicly in utm_id on every link in this campaign — it is
          the reporting join key.
        </p>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Metadata</h2>
          <div className="table-wrap">
            <table className="kv-table">
              <tbody>
                <tr>
                  <th scope="row">Initiative</th>
                  <td>
                    {campaign.initiativeId ? (
                      <Link href={`/initiatives/${campaign.initiativeId}`} className="mono small">
                        {campaign.initiativeId}
                      </Link>
                    ) : (
                      <span className="muted">Standalone</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Product</th>
                  <td>{campaign.product ?? <span className="muted">—</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Type</th>
                  <td>{campaign.campaignType ?? <span className="muted">—</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Start</th>
                  <td>{fmtDate(campaign.startDate)}</td>
                </tr>
                <tr>
                  <th scope="row">End</th>
                  <td>{fmtDate(campaign.endDate)}</td>
                </tr>
                <tr>
                  <th scope="row">Description</th>
                  <td>{campaign.description ?? <span className="muted">—</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Owner</th>
                  <td>{users.find((user) => user.id === campaign.ownerId)?.email ?? campaign.ownerId ?? <span className="muted">Unassigned</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Created</th>
                  <td>{fmtDateTime(campaign.createdAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {detail.permissions.canTransferOwnership ? (
            <div className="inline-form">
              <h3>Transfer ownership</h3>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="campaign-owner">New owner</label>
                  <select id="campaign-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                    <option value="">Select an active owner…</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="campaign-owner-reason">Reason (required and audited)</label>
                  <input id="campaign-owner-reason" value={ownerReason} onChange={(event) => setOwnerReason(event.target.value)} />
                </div>
              </div>
              <button type="button" disabled={savingOwner || !ownerId || !ownerReason.trim() || ownerId === campaign.ownerId} onClick={() => void transferOwnership()}>
                {savingOwner ? "Saving…" : "Transfer ownership"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>External system mappings</h2>
          {mappings.length === 0 ? (
            <p className="muted">No external mappings.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>System</th>
                    <th>External ID</th>
                    <th>Sync state</th>
                    <th>Last attempt</th>
                    <th>Last success</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{m.system}</td>
                      <td className="mono small">{m.externalId ?? <span className="muted">pending</span>}</td>
                      <td>
                        <Badge value={m.syncState} />
                        {m.lastError ? (
                          <div className="small" style={{ color: "var(--err)" }}>
                            {m.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td className="nowrap small">{fmtDateTime(m.lastAttemptAt)}</td>
                      <td className="nowrap small">{fmtDateTime(m.lastSuccessAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Links in this campaign {links ? `(${links.total})` : ""}</h2>
        <div className="btn-row" style={{ marginTop: 0, marginBottom: "0.6rem" }}>
          <a className="btn" href={`/api/export/links?campaignId=${encodeURIComponent(campaign.id)}`}>
            Export links CSV
          </a>
          <Link className="btn" href={`/registry?campaignId=${encodeURIComponent(campaign.id)}`}>
            View in registry
          </Link>
        </div>
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
              {(links?.rows ?? []).map(({ link }) => (
                <tr key={link.id}>
                  <td>
                    <Link href={`/registry/links/${link.id}`} className="url-cell mono small" title={link.finalUrl}>
                      {link.finalUrl}
                    </Link>{" "}
                    <CopyButton text={link.finalUrl} />
                  </td>
                  <td className="nowrap mono small">
                    {link.utmSource} / {link.utmMedium}
                  </td>
                  <td>
                    <Badge value={link.status} />
                  </td>
                  <td className="nowrap small">{fmtDateTime(link.createdAt)}</td>
                </tr>
              ))}
              {links && links.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No links issued in this campaign yet.
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
