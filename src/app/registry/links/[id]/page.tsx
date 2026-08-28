"use client";

/**
 * Link detail: full state, revision history with diffs, validation runs,
 * revise (reason required) and retire (reason required). All mutations go
 * through PATCH/DELETE /api/links/[id].
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, CopyButton, FindingList, JsonDetails, Msg } from "../../../components";
import {
  api,
  ApiError,
  errText,
  fmtDateTime,
  type Finding,
  type LinkRec,
  type LinkRevision,
  type ValidationRun,
} from "../../../lib";

interface LinkDetail {
  link: LinkRec;
  revisions: LinkRevision[];
  validations: ValidationRun[];
}

interface ReviseForm {
  destination: string;
  utmSource: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
  presetKey: string;
  reason: string;
}

export default function LinkDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<LinkDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [showRevise, setShowRevise] = useState(false);
  const [form, setForm] = useState<ReviseForm | null>(null);
  const [reviseError, setReviseError] = useState("");
  const [reviseFindings, setReviseFindings] = useState<Finding[]>([]);
  const [revising, setRevising] = useState(false);
  const [notice, setNotice] = useState("");

  const [showRetire, setShowRetire] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [retireError, setRetireError] = useState("");
  const [retiring, setRetiring] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await api<LinkDetail>(`/api/links/${id}`);
      setDetail(d);
      setError("");
      setForm({
        destination: d.link.destinationRaw,
        utmSource: d.link.utmSource,
        utmMedium: d.link.utmMedium,
        utmContent: d.link.utmContent ?? "",
        utmTerm: d.link.utmTerm ?? "",
        presetKey: d.link.platformPresetKey,
        reason: "",
      });
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const revise = useCallback(async () => {
    if (!form) return;
    setRevising(true);
    setReviseError("");
    setReviseFindings([]);
    setNotice("");
    try {
      await api(`/api/links/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          destination: form.destination,
          utmSource: form.utmSource,
          utmMedium: form.utmMedium,
          utmContent: form.utmContent || null,
          utmTerm: form.utmTerm || null,
          presetKey: form.presetKey,
          reason: form.reason,
        }),
      });
      setNotice("Link revised.");
      setShowRevise(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.findings) setReviseFindings(err.findings);
      setReviseError(errText(err));
    } finally {
      setRevising(false);
    }
  }, [form, id, load]);

  const retire = useCallback(async () => {
    setRetiring(true);
    setRetireError("");
    setNotice("");
    try {
      await api(`/api/links/${id}?reason=${encodeURIComponent(retireReason)}`, {
        method: "DELETE",
      });
      setNotice("Link retired.");
      setShowRetire(false);
      await load();
    } catch (err) {
      setRetireError(errText(err));
    } finally {
      setRetiring(false);
    }
  }, [id, retireReason, load]);

  if (loading && !detail) {
    return <p aria-live="polite">Loading link…</p>;
  }
  if (error && !detail) {
    return <Msg kind="error">{error}</Msg>;
  }
  if (!detail) return null;

  const { link, revisions, validations } = detail;
  const sortedRevisions = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  const sortedValidations = [...validations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const setField = (key: keyof ReviseForm, value: string) =>
    setForm((cur) => (cur ? { ...cur, [key]: value } : cur));

  return (
    <div>
      <h1 className="mono">{link.id}</h1>
      <p className="page-sub">
        <Badge value={link.status} /> <Badge value={link.validationState} />{" "}
        {link.duplicateOverride ? <Badge value="warning">duplicate override</Badge> : null}{" "}
        Revision {link.currentRevision} · Config v{link.configVersion}
      </p>

      <Msg kind="success">{notice}</Msg>
      <Msg kind="error">{detail ? error : ""}</Msg>

      <div className="card">
        <h2>Final URL</h2>
        <div className="final-url mono">{link.finalUrl}</div>
        <div className="btn-row">
          <CopyButton text={link.finalUrl} label="Copy URL" />
          <CopyButton text={link.id} label="Copy link ID" />
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Identity &amp; UTM fields</h2>
          <div className="table-wrap">
            <table className="kv-table">
              <tbody>
                <tr>
                  <th scope="row">Link ID</th>
                  <td className="mono">{link.id}</td>
                </tr>
                <tr>
                  <th scope="row">Campaign</th>
                  <td>
                    <Link href={`/campaigns/${link.campaignId}`} className="mono">
                      {link.campaignId}
                    </Link>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Initiative</th>
                  <td>
                    {link.initiativeId ? (
                      <Link href={`/initiatives/${link.initiativeId}`} className="mono">
                        {link.initiativeId}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Batch</th>
                  <td>
                    {link.batchId ? (
                      <Link href={`/registry?q=${encodeURIComponent(link.batchId)}`} className="mono">
                        {link.batchId}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Destination (raw)</th>
                  <td className="mono small">{link.destinationRaw}</td>
                </tr>
                <tr>
                  <th scope="row">Destination (normalized)</th>
                  <td className="mono small">{link.destinationNormalized}</td>
                </tr>
                <tr>
                  <th scope="row">utm_id</th>
                  <td className="mono">{link.utmId}</td>
                </tr>
                <tr>
                  <th scope="row">utm_source</th>
                  <td className="mono">{link.utmSource}</td>
                </tr>
                <tr>
                  <th scope="row">utm_medium</th>
                  <td className="mono">{link.utmMedium}</td>
                </tr>
                <tr>
                  <th scope="row">utm_campaign</th>
                  <td className="mono">{link.utmCampaign}</td>
                </tr>
                <tr>
                  <th scope="row">utm_content</th>
                  <td className="mono">{link.utmContent ?? <span className="muted">—</span>}</td>
                </tr>
                <tr>
                  <th scope="row">utm_term</th>
                  <td className="mono">{link.utmTerm ?? <span className="muted">—</span>}</td>
                </tr>
                <tr>
                  <th scope="row">rp_link_id param</th>
                  <td className="mono">{link.rpLinkIdParam ?? <span className="muted">disabled by policy</span>}</td>
                </tr>
                <tr>
                  <th scope="row">rp_initiative_id param</th>
                  <td className="mono">{link.rpInitiativeIdParam ?? <span className="muted">disabled by policy</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Platform preset</th>
                  <td className="mono">{link.platformPresetKey}</td>
                </tr>
                <tr>
                  <th scope="row">Created by</th>
                  <td className="mono small">{link.createdBy}</td>
                </tr>
                <tr>
                  <th scope="row">Created</th>
                  <td>{fmtDateTime(link.createdAt)}</td>
                </tr>
                <tr>
                  <th scope="row">Issued</th>
                  <td>{fmtDateTime(link.issuedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Actions</h2>
            {link.status === "retired" ? (
              <p className="muted">This link is retired — no further changes are allowed.</p>
            ) : (
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button type="button" onClick={() => setShowRevise((v) => !v)}>
                  {showRevise ? "Cancel revise" : "Revise link"}
                </button>
                <button type="button" className="btn-danger" onClick={() => setShowRetire((v) => !v)}>
                  {showRetire ? "Cancel retire" : "Retire link"}
                </button>
              </div>
            )}

            {showRevise && form ? (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="rev-destination">Destination</label>
                  <input
                    id="rev-destination"
                    type="url"
                    value={form.destination}
                    onChange={(e) => setField("destination", e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="rev-source">utm_source</label>
                    <input
                      id="rev-source"
                      type="text"
                      value={form.utmSource}
                      onChange={(e) => setField("utmSource", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="rev-medium">utm_medium</label>
                    <input
                      id="rev-medium"
                      type="text"
                      value={form.utmMedium}
                      onChange={(e) => setField("utmMedium", e.target.value)}
                    />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="rev-content">utm_content</label>
                    <input
                      id="rev-content"
                      type="text"
                      value={form.utmContent}
                      onChange={(e) => setField("utmContent", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="rev-term">utm_term</label>
                    <input
                      id="rev-term"
                      type="text"
                      value={form.utmTerm}
                      onChange={(e) => setField("utmTerm", e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="rev-preset">Preset key</label>
                  <input
                    id="rev-preset"
                    type="text"
                    value={form.presetKey}
                    onChange={(e) => setField("presetKey", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="rev-reason">
                    Reason <span className="hint">(required, recorded in the revision history)</span>
                  </label>
                  <textarea
                    id="rev-reason"
                    value={form.reason}
                    onChange={(e) => setField("reason", e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={revising || !form.reason.trim()}
                  onClick={() => void revise()}
                >
                  {revising ? "Revising…" : "Save revision"}
                </button>
                <Msg kind="error">{reviseError}</Msg>
                <FindingList findings={reviseFindings} />
              </div>
            ) : null}

            {showRetire ? (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="retire-reason">
                    Retire reason <span className="hint">(required, audited)</span>
                  </label>
                  <textarea
                    id="retire-reason"
                    value={retireReason}
                    onChange={(e) => setRetireReason(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={retiring || !retireReason.trim()}
                  onClick={() => void retire()}
                >
                  {retiring ? "Retiring…" : "Confirm retire"}
                </button>
                <Msg kind="error">{retireError}</Msg>
              </div>
            ) : null}
          </div>

          <div className="card">
            <h2>Validation runs</h2>
            {sortedValidations.length === 0 ? (
              <p className="muted">No validation runs recorded.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Kind</th>
                      <th>Result</th>
                      <th>Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedValidations.map((v) => (
                      <tr key={v.id}>
                        <td className="nowrap small">{fmtDateTime(v.createdAt)}</td>
                        <td>{v.kind}</td>
                        <td>
                          <Badge value={v.passed ? "passed" : "failed"} />
                        </td>
                        <td>
                          {Array.isArray(v.findings) && v.findings.length ? (
                            <FindingList findings={v.findings} />
                          ) : (
                            <span className="muted">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Revision history</h2>
        {sortedRevisions.length === 0 ? (
          <p className="muted">No revisions yet — this link is at its issued state.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rev</th>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Reason</th>
                  <th>Changes (before → after)</th>
                  <th>Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {sortedRevisions.map((r) => (
                  <tr key={r.id}>
                    <td>{r.revisionNumber}</td>
                    <td className="nowrap small">{fmtDateTime(r.createdAt)}</td>
                    <td className="mono small">{r.actorId}</td>
                    <td>{r.reason ?? <span className="muted">—</span>}</td>
                    <td>
                      {r.diff && Object.keys(r.diff).length ? (
                        <ul className="findings">
                          {Object.entries(r.diff).map(([field, change]) => (
                            <li key={field} className="finding-warning">
                              <span className="mono">{field}</span>:{" "}
                              <span className="diff-before mono small">
                                {String(change.before ?? "—")}
                              </span>{" "}
                              →{" "}
                              <span className="diff-after mono small">
                                {String(change.after ?? "—")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <JsonDetails label="View snapshot" value={r.snapshot} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
