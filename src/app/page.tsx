"use client";

/**
 * Single-link builder. Everything material — normalization, validation,
 * duplicate detection, URL assembly, ID minting — happens server-side via
 * /api/links/preview and /api/links. This page only collects input and
 * renders what the API returns.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, CopyButton, FindingList, Msg, useSession } from "./components";
import {
  api,
  ApiError,
  errText,
  qs,
  type Campaign,
  type Finding,
  type Initiative,
  type IssueResult,
  type Preset,
  type PreviewResult,
  type Taxonomy,
} from "./lib";

export default function BuilderPage() {
  const { session } = useSession();
  const isAdmin = session?.role === "admin";

  // Reference data
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ mediums: [], sources: [] });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadError, setLoadError] = useState("");

  // Form state
  const [destination, setDestination] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [presetKey, setPresetKey] = useState("generic");
  const [medium, setMedium] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");

  // Inline create forms
  const [showNewInitiative, setShowNewInitiative] = useState(false);
  const [newInitiativeName, setNewInitiativeName] = useState("");
  const [newInitiativeErr, setNewInitiativeErr] = useState("");
  const [creatingInitiative, setCreatingInitiative] = useState(false);

  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignSlug, setNewCampaignSlug] = useState("");
  const [newCampaignErr, setNewCampaignErr] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewSeq = useRef(0);

  // Submission state
  const [submitting, setSubmitting] = useState<"" | "draft" | "issued">("");
  const [submitError, setSubmitError] = useState("");
  const [submitFindings, setSubmitFindings] = useState<Finding[]>([]);
  const [issued, setIssued] = useState<IssueResult | null>(null);

  // Duplicate handling state
  const [overrideReason, setOverrideReason] = useState("");
  const [reuseStatus, setReuseStatus] = useState("");
  const [reusedUrl, setReusedUrl] = useState("");

  const loadCampaigns = useCallback(async () => {
    const d = await api<{ campaigns: Campaign[] }>("/api/campaigns");
    setCampaigns(d.campaigns);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [ini, tax, pre] = await Promise.all([
          api<{ initiatives: Initiative[] }>("/api/initiatives"),
          api<Taxonomy>("/api/taxonomy"),
          api<{ presets: Preset[] }>("/api/presets"),
        ]);
        setInitiatives(ini.initiatives);
        setTaxonomy(tax);
        setPresets(pre.presets);
        await loadCampaigns();
      } catch (err) {
        setLoadError(errText(err));
      }
    })();
  }, [loadCampaigns]);

  const selectedPreset = presets.find((p) => p.key === presetKey) ?? null;
  const visibleCampaigns = initiativeId
    ? campaigns.filter((c) => c.initiativeId === initiativeId)
    : campaigns;
  const activeMediums = taxonomy.mediums.filter((m) => m.status === "active");
  const visibleSources = taxonomy.sources.filter(
    (s) => s.status === "active" && (!medium || s.mediumSlug === medium),
  );

  // Preset defaults fill empty medium/source (the server applies the same
  // rule; this just makes the choice visible before preview).
  const applyPreset = useCallback(
    (key: string) => {
      setPresetKey(key);
      const preset = presets.find((p) => p.key === key);
      if (!preset) return;
      const defaults = preset.defaults ?? {};
      if (defaults.utm_medium) setMedium((cur) => cur || defaults.utm_medium);
      if (defaults.utm_source) setSource((cur) => cur || defaults.utm_source);
    },
    [presets],
  );

  // Debounced live preview via the API. Never computed client-side.
  useEffect(() => {
    setIssued(null);
    setSubmitError("");
    setSubmitFindings([]);
    setReusedUrl("");
    setReuseStatus("");
    if (!destination.trim()) {
      setPreview(null);
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const result = await api<PreviewResult>("/api/links/preview", {
          method: "POST",
          body: JSON.stringify({
            destination,
            campaignId,
            presetKey: presetKey || undefined,
            utmSource: source,
            utmMedium: medium,
            utmContent: content || undefined,
            utmTerm: term || undefined,
          }),
        });
        if (previewSeq.current !== seq) return;
        setPreview(result);
        setPreviewError("");
      } catch (err) {
        if (previewSeq.current !== seq) return;
        setPreview(null);
        setPreviewError(errText(err));
      } finally {
        if (previewSeq.current === seq) setPreviewLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [destination, campaignId, presetKey, source, medium, content, term]);

  const createInitiative = useCallback(async () => {
    if (!newInitiativeName.trim()) {
      setNewInitiativeErr("Name is required.");
      return;
    }
    setCreatingInitiative(true);
    setNewInitiativeErr("");
    try {
      const d = await api<{ initiative: Initiative }>("/api/initiatives", {
        method: "POST",
        body: JSON.stringify({ name: newInitiativeName.trim() }),
      });
      setInitiatives((cur) => [...cur, d.initiative]);
      setInitiativeId(d.initiative.id);
      setNewInitiativeName("");
      setShowNewInitiative(false);
    } catch (err) {
      setNewInitiativeErr(errText(err));
    } finally {
      setCreatingInitiative(false);
    }
  }, [newInitiativeName]);

  const createCampaign = useCallback(async () => {
    if (!newCampaignName.trim()) {
      setNewCampaignErr("Campaign name is required.");
      return;
    }
    setCreatingCampaign(true);
    setNewCampaignErr("");
    try {
      const d = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: newCampaignName.trim(),
          utmCampaign: newCampaignSlug.trim() || undefined,
          initiativeId: initiativeId || undefined,
        }),
      });
      await loadCampaigns();
      setCampaignId(d.campaign.id);
      setNewCampaignName("");
      setNewCampaignSlug("");
      setShowNewCampaign(false);
    } catch (err) {
      setNewCampaignErr(errText(err));
    } finally {
      setCreatingCampaign(false);
    }
  }, [newCampaignName, newCampaignSlug, initiativeId, loadCampaigns]);

  const submit = useCallback(
    async (status: "draft" | "issued", withOverride = false) => {
      setSubmitting(status);
      setSubmitError("");
      setSubmitFindings([]);
      setIssued(null);
      try {
        const result = await api<IssueResult>("/api/links", {
          method: "POST",
          body: JSON.stringify({
            destination,
            campaignId,
            presetKey: presetKey || undefined,
            utmSource: source,
            utmMedium: medium,
            utmContent: content || undefined,
            utmTerm: term || undefined,
            status,
            ...(withOverride
              ? { duplicateAction: "override", duplicateReason: overrideReason }
              : {}),
          }),
        });
        setIssued(result);
      } catch (err) {
        if (err instanceof ApiError) {
          setSubmitError(err.message);
          if (err.findings) setSubmitFindings(err.findings);
        } else {
          setSubmitError(errText(err));
        }
      } finally {
        setSubmitting("");
      }
    },
    [destination, campaignId, presetKey, source, medium, content, term, overrideReason],
  );

  const reuseExisting = useCallback(async (linkId: string, finalUrl: string) => {
    setReuseStatus("Recording reuse…");
    try {
      await api(`/api/links/${linkId}/reuse`, { method: "POST" });
      setReusedUrl(finalUrl);
      setReuseStatus("Reuse recorded. Use the existing link below.");
    } catch (err) {
      setReuseStatus(errText(err));
    }
  }, []);

  const exact = preview?.duplicates.exact ?? null;

  return (
    <div>
      <h1>Link Builder</h1>
      <p className="page-sub">
        Build one governed campaign link. The registry validates, deduplicates, and issues it.
      </p>
      <Msg kind="error">{loadError}</Msg>

      <div className="two-col">
        <div className="card">
          <h2>Link details</h2>

          <div className="field">
            <label htmlFor="destination">Destination URL</label>
            <input
              id="destination"
              type="url"
              placeholder="https://www.runpod.io/serverless"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="initiative">
              Initiative <span className="hint">(optional grouping)</span>
            </label>
            <select
              id="initiative"
              value={initiativeId}
              onChange={(e) => {
                setInitiativeId(e.target.value);
                setCampaignId("");
              }}
            >
              <option value="">All initiatives</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-link small"
              onClick={() => setShowNewInitiative((v) => !v)}
            >
              {showNewInitiative ? "Cancel new initiative" : "+ Create initiative"}
            </button>
            {showNewInitiative ? (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="new-initiative-name">New initiative name</label>
                  <input
                    id="new-initiative-name"
                    type="text"
                    value={newInitiativeName}
                    onChange={(e) => setNewInitiativeName(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={creatingInitiative}
                  onClick={() => void createInitiative()}
                >
                  {creatingInitiative ? "Creating…" : "Create initiative"}
                </button>
                <Msg kind="error">{newInitiativeErr}</Msg>
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="campaign">Campaign</label>
            <select id="campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Select a campaign…</option>
              {visibleCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.utmCampaign})
                </option>
              ))}
            </select>
            <p className="hint" style={{ margin: "0.2rem 0 0" }}>
              Campaigns are never auto-created from a typed name — create one explicitly if it
              does not exist yet.
            </p>
            <button
              type="button"
              className="btn-link small"
              onClick={() => setShowNewCampaign((v) => !v)}
            >
              {showNewCampaign ? "Cancel new campaign" : "+ Create campaign"}
            </button>
            {showNewCampaign ? (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="new-campaign-name">New campaign name</label>
                  <input
                    id="new-campaign-name"
                    type="text"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-campaign-slug">
                    utm_campaign slug <span className="hint">(optional — defaults from name)</span>
                  </label>
                  <input
                    id="new-campaign-slug"
                    type="text"
                    value={newCampaignSlug}
                    onChange={(e) => setNewCampaignSlug(e.target.value)}
                  />
                </div>
                <p className="hint">
                  {initiativeId
                    ? "Will be attached to the selected initiative."
                    : "No initiative selected — the campaign will be standalone."}
                </p>
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={creatingCampaign}
                  onClick={() => void createCampaign()}
                >
                  {creatingCampaign ? "Creating…" : "Create campaign"}
                </button>
                <Msg kind="error">{newCampaignErr}</Msg>
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="preset">Platform preset</label>
            <select id="preset" value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
            {selectedPreset ? (
              <p className="small" style={{ margin: "0.25rem 0 0" }}>
                <Badge value={selectedPreset.verificationState} />{" "}
                {Object.keys(selectedPreset.defaults ?? {}).length ? (
                  <span className="muted">
                    Defaults:{" "}
                    {Object.entries(selectedPreset.defaults)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}{" "}
                    (applied when the field is empty)
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="medium">utm_medium</label>
              <select
                id="medium"
                value={medium}
                onChange={(e) => {
                  setMedium(e.target.value);
                  setSource("");
                }}
              >
                <option value="">Select medium…</option>
                {activeMediums.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.label} ({m.slug})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="source">utm_source</label>
              <select id="source" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Select source…</option>
                {visibleSources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label} ({s.slug})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="content">
                utm_content <span className="hint">(variant / placement)</span>
              </label>
              <input
                id="content"
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="term">
                utm_term <span className="hint">(paid keyword)</span>
              </label>
              <input id="term" type="text" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>

          <div className="btn-row">
            <button
              type="button"
              disabled={submitting !== "" || !destination.trim() || !campaignId}
              onClick={() => void submit("draft")}
            >
              {submitting === "draft" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={submitting !== "" || !destination.trim() || !campaignId}
              onClick={() => void submit("issued")}
            >
              {submitting === "issued" ? "Issuing…" : "Issue link"}
            </button>
          </div>

          <Msg kind="error">{submitError}</Msg>
          <FindingList findings={submitFindings} />

          {issued ? (
            <Msg kind="success">
              <strong>{issued.link.status === "draft" ? "Draft saved." : "Link issued."}</strong>
              <div className="final-url mono">{issued.link.finalUrl}</div>
              <div className="btn-row">
                <CopyButton text={issued.link.finalUrl} label="Copy URL" />
                <span className="mono small">{issued.link.id}</span>
                <CopyButton text={issued.link.id} label="Copy ID" />
                <Link href={`/registry/links/${issued.link.id}`}>Open in registry →</Link>
              </div>
            </Msg>
          ) : null}
        </div>

        <div className="card" aria-live="polite">
          <h2>
            Live preview{" "}
            {previewLoading ? <span className="hint">(checking with the registry…)</span> : null}
          </h2>
          <Msg kind="error">{previewError}</Msg>
          {!destination.trim() ? (
            <p className="muted">Enter a destination URL to see validation and the final URL.</p>
          ) : null}
          {preview ? (
            <>
              <h3>Normalized destination</h3>
              <p className="mono small">{preview.normalizedDestination ?? "—"}</p>

              <h3>Final URL preview</h3>
              {preview.finalUrlPreview ? (
                <>
                  <div className="final-url mono">{preview.finalUrlPreview}</div>
                  <p className="hint">
                    rpl_PREVIEW is a placeholder — the real link ID is minted only at issuance.
                  </p>
                </>
              ) : (
                <p className="muted">Select a campaign to generate the URL preview.</p>
              )}

              {preview.utm ? (
                <>
                  <h3>Generated UTM parameters</h3>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {Object.entries(preview.utm).map(([k, v]) => (
                          <tr key={k}>
                            <th scope="row" className="mono">
                              {k}
                            </th>
                            <td className="mono">{v ?? <span className="muted">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <h3>Validation</h3>
              {preview.validation.findings.length === 0 ? (
                <Msg kind="success">All checks passed.</Msg>
              ) : (
                <FindingList findings={preview.validation.findings} />
              )}

              {exact ? (
                <div>
                  <h3>Exact duplicate</h3>
                  <Msg kind="error">
                    An identical governed link already exists:{" "}
                    <Link href={`/registry/links/${exact.linkId}`} className="mono">
                      {exact.linkId}
                    </Link>
                  </Msg>
                  <div className="final-url mono">{exact.finalUrl}</div>
                  <div className="btn-row">
                    <button
                      type="button"
                      onClick={() => void reuseExisting(exact.linkId, exact.finalUrl)}
                    >
                      Reuse existing link
                    </button>
                    <CopyButton text={exact.finalUrl} label="Copy existing URL" />
                  </div>
                  <Msg kind="info">{reuseStatus}</Msg>
                  {reusedUrl ? (
                    <Msg kind="success">
                      <div className="final-url mono">{reusedUrl}</div>
                      <CopyButton text={reusedUrl} label="Copy URL" />
                    </Msg>
                  ) : null}
                  {isAdmin ? (
                    <div className="inline-form">
                      <div className="field">
                        <label htmlFor="override-reason">
                          Admin override — reason <span className="hint">(required, audited)</span>
                        </label>
                        <textarea
                          id="override-reason"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn-danger btn-small"
                        disabled={!overrideReason.trim() || submitting !== ""}
                        onClick={() => void submit("issued", true)}
                      >
                        Issue anyway (override duplicate)
                      </button>
                    </div>
                  ) : (
                    <p className="hint">
                      Only authorized roles can override an exact duplicate. Reuse the existing
                      link instead.
                    </p>
                  )}
                </div>
              ) : null}

              {preview.duplicates.near.length > 0 ? (
                <div>
                  <h3>Near duplicates</h3>
                  <ul className="findings">
                    {preview.duplicates.near.map((n) => (
                      <li key={n.linkId} className="finding-warning">
                        <Link href={`/registry/links/${n.linkId}`} className="mono">
                          {n.linkId}
                        </Link>{" "}
                        ({n.kind}) <span className="mono small">{n.finalUrl}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
