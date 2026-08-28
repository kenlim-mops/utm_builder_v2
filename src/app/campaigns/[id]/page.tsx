"use client";

/**
 * Campaign detail: metadata (utm_id = campaign ID, shown prominently),
 * HubSpot mapping sync state, and related links from the registry.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, CopyButton, Msg } from "../../components";
import {
  api,
  errText,
  fmtDate,
  fmtDateTime,
  qs,
  type Campaign,
  type CampaignMapping,
  type LinkSearchResult,
} from "../../lib";

interface CampaignDetail {
  campaign: Campaign;
  mappings: CampaignMapping[];
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [links, setLinks] = useState<LinkSearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [d, l] = await Promise.all([
          api<CampaignDetail>(`/api/campaigns/${id}`),
          api<LinkSearchResult>(`/api/links${qs({ campaignId: id, pageSize: 100 })}`),
        ]);
        if (!cancelled) {
          setDetail(d);
          setLinks(l);
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
  }, [id]);

  if (loading) return <p aria-live="polite">Loading campaign…</p>;
  if (error) return <Msg kind="error">{error}</Msg>;
  if (!detail) return null;

  const { campaign, mappings } = detail;

  return (
    <div>
      <h1>{campaign.name}</h1>
      <p className="page-sub">
        <Badge value={campaign.lifecycle} /> utm_campaign:{" "}
        <span className="mono">{campaign.utmCampaign}</span>
      </p>

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
                  <th scope="row">Created</th>
                  <td>{fmtDateTime(campaign.createdAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
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
