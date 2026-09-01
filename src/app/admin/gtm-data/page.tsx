"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Badge, JsonDetails, Msg } from "../../components";
import { api, errText, fmtDateTime } from "../../lib";

type CatalogRecord = {
  id: string;
  recordType: string;
  key: string;
  name: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  sensitivity: string;
  lifecycle: string;
  verificationState: string;
  sourceUrl: string | null;
  updatedAt: string;
};
type Template = {
  id: string;
  key: string;
  name: string;
  platformKey: string;
  operation: string;
  objectType: string;
  format: "csv" | "xlsx" | "json";
  columns: unknown[];
  defaults: Record<string, unknown>;
  validations: Record<string, unknown>;
  examples: unknown[];
  maxRows: number | null;
  verificationState: string;
  lifecycle: string;
  availabilityNotes: string | null;
  docsUrl: string | null;
};
type Connector = {
  id: string;
  key: string;
  name: string;
  sourceType: string;
  status: string;
  mode: string;
  autoApply: boolean;
  authoritativeFields: string[];
  scheduleMinutes: number;
  config: Record<string, unknown>;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastError: string | null;
};
type ProposalBundle = {
  proposal: {
    id: string;
    proposalType: string;
    status: string;
    diff: Record<string, unknown>;
    createdAt: string;
  };
  connector: Connector;
  source: { externalId: string; sourceUrl: string | null };
};
type SyncRun = {
  id: string;
  connectorId: string;
  status: string;
  trigger: string;
  seenCount: number;
  changedCount: number;
  appliedCount: number;
  proposedCount: number;
  error: string | null;
  startedAt: string;
};
type Data = {
  records: CatalogRecord[];
  templates: Template[];
  connectors: Connector[];
  updates: ProposalBundle[];
  syncRuns: SyncRun[];
};

const RECORD_TYPES = [
  "person", "team", "agency", "vendor", "system", "account", "integration",
  "data_term", "data_field", "measurement_asset", "runbook", "policy", "report",
];

function ConnectorControls({ connector, busy, onSave, onRun }: {
  connector: Connector;
  busy: boolean;
  onSave: (connector: Record<string, unknown>) => Promise<void>;
  onRun: () => Promise<void>;
}) {
  const [status, setStatus] = useState(connector.status);
  const [autoApply, setAutoApply] = useState(connector.autoApply);
  const [fields, setFields] = useState(connector.authoritativeFields.join(", "));
  return <div>
    <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="paused">paused</option><option value="active">active</option><option value="error">error / quarantined</option></select></label>
    <label>Authoritative fields<input value={fields} onChange={(e) => setFields(e.target.value)} placeholder="name, summary" /></label>
    <label className="checkbox-row"><input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />Auto-apply allowlisted fields</label>
    <div className="btn-row" style={{ margin: 0 }}>
      <button type="button" className="btn-small" disabled={busy} onClick={() => void onSave({
        id: connector.id, key: connector.key, name: connector.name,
        sourceType: connector.sourceType, mode: connector.mode, status,
        config: connector.config, credentialRef: "env:NOTION_API_TOKEN",
        scheduleMinutes: connector.scheduleMinutes, autoApply,
        authoritativeFields: fields.split(",").map((value) => value.trim()).filter(Boolean),
      })}>Save controls</button>
      <button type="button" className="btn-small" disabled={busy} onClick={() => void onRun()}>Scan now</button>
    </div>
  </div>;
}

function TemplateControls({ template, busy, onSave, onDownload }: {
  template: Template;
  busy: boolean;
  onSave: (verificationState: string, lifecycle: string) => Promise<void>;
  onDownload: () => Promise<void>;
}) {
  const [verification, setVerification] = useState(template.verificationState);
  const [lifecycle, setLifecycle] = useState(template.lifecycle);
  return <div>
    <select aria-label={`Verification for ${template.name}`} value={verification} onChange={(e) => setVerification(e.target.value)}><option value="draft">draft</option><option value="verified">verified</option><option value="deprecated">deprecated</option></select>
    <select aria-label={`Lifecycle for ${template.name}`} value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}><option value="active">active</option><option value="inactive">inactive</option><option value="deprecated">deprecated</option></select>
    <div className="btn-row" style={{ margin: 0 }}><button type="button" className="btn-small" disabled={busy} onClick={() => void onSave(verification, lifecycle)}>Save</button><button type="button" className="btn-small" onClick={() => void onDownload()}>Download CSV</button></div>
  </div>;
}

export default function GtmDataAdminPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [recordForm, setRecordForm] = useState({ id: "", recordType: "system", key: "", name: "", summary: "", sensitivity: "internal", attributes: "{}" });
  const [relationshipForm, setRelationshipForm] = useState({ fromRecordId: "", relationshipType: "owns", toRecordId: "" });
  const [connectorForm, setConnectorForm] = useState({ key: "", name: "", dataSourceId: "", recordType: "system", titleProperty: "Name", keyProperty: "Key", summaryProperty: "Description", attributeMap: "{}", scheduleMinutes: "60" });
  const [reviewReason, setReviewReason] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/admin/gtm-data"));
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connectorNames = useMemo(
    () => new Map((data?.connectors ?? []).map((item) => [item.id, item.name])),
    [data?.connectors],
  );

  async function act(action: string, body: Record<string, unknown>, success: string) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await api("/api/admin/gtm-data", { method: "POST", body: JSON.stringify({ action, ...body }) });
      setNotice(success);
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy("");
    }
  }

  async function createRecord(event: FormEvent) {
    event.preventDefault();
    let attributes: Record<string, unknown>;
    try { attributes = JSON.parse(recordForm.attributes); } catch { setError("Attributes must be a valid JSON object."); return; }
    await act("upsert_record", {
      record: {
        ...recordForm,
        id: recordForm.id || undefined,
        attributes,
        ...(recordForm.id ? {} : { lifecycle: "active", verificationState: "unverified" }),
      },
      reason: recordForm.id ? "Updated in GTM Data MCP admin" : "Created in GTM Data MCP admin",
    }, recordForm.id ? "Catalog record updated." : "Catalog record created.");
    setRecordForm((value) => ({ ...value, id: "", key: "", name: "", summary: "", attributes: "{}" }));
  }

  async function createRelationship(event: FormEvent) {
    event.preventDefault();
    await act("upsert_relationship", { relationship: { ...relationshipForm, isPrimary: relationshipForm.relationshipType === "owns" }, reason: "Mapped in GTM Data MCP admin" }, "Relationship saved.");
  }

  async function createConnector(event: FormEvent) {
    event.preventDefault();
    let attributeMap: Record<string, string>;
    try { attributeMap = JSON.parse(connectorForm.attributeMap); } catch { setError("Notion attribute mapping must be a valid JSON object."); return; }
    await act("upsert_connector", {
      connector: {
        key: connectorForm.key,
        name: connectorForm.name,
        sourceType: "notion",
        mode: "poll",
        status: "paused",
        credentialRef: "env:NOTION_API_TOKEN",
        scheduleMinutes: Number(connectorForm.scheduleMinutes),
        autoApply: false,
        authoritativeFields: [],
        config: {
          dataSourceId: connectorForm.dataSourceId,
          recordType: connectorForm.recordType,
          titleProperty: connectorForm.titleProperty,
          keyProperty: connectorForm.keyProperty || undefined,
          summaryProperty: connectorForm.summaryProperty || undefined,
          attributeMap,
        },
      },
      reason: "Created in GTM Data MCP admin; paused until mapping verification",
    }, "Connector created in paused, review-first mode.");
  }

  async function downloadTemplate(template: Template) {
    try {
      const result = await api<{ csv: string }>(`/api/admin/gtm-data?templateKey=${encodeURIComponent(template.key)}`);
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${template.key}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(errText(err)); }
  }

  return (
    <div>
      <h1>GTM Data MCP</h1>
      <p className="page-sub">
        Governed operating context for people, ownership, platforms, accounts, integrations,
        definitions, runbooks, mass-change templates, and external source updates.
      </p>
      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <h2>Safety model</h2>
        <p className="small muted">
          Source scans preserve evidence and propose differences. New connectors start paused and
          review-first. Automatic application remains off unless an administrator explicitly marks
          both the connector and an allowlist of fields as authoritative.
        </p>
      </div>

      <div className="card">
        <h2>Catalog ({data?.records.length ?? 0})</h2>
        <form onSubmit={(event) => void createRecord(event)}>
          <div className="form-grid">
            <label>Type<select value={recordForm.recordType} onChange={(e) => setRecordForm({ ...recordForm, recordType: e.target.value })}>{RECORD_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Stable key<input required value={recordForm.key} onChange={(e) => setRecordForm({ ...recordForm, key: e.target.value })} placeholder="google_ads" /></label>
            <label>Name<input required value={recordForm.name} onChange={(e) => setRecordForm({ ...recordForm, name: e.target.value })} placeholder="Google Ads" /></label>
            <label>Sensitivity<select value={recordForm.sensitivity} onChange={(e) => setRecordForm({ ...recordForm, sensitivity: e.target.value })}><option value="internal">internal</option><option value="restricted">restricted</option></select></label>
          </div>
          <label>Summary<textarea value={recordForm.summary} onChange={(e) => setRecordForm({ ...recordForm, summary: e.target.value })} /></label>
          <label>Type-specific attributes (JSON)<textarea className="mono" value={recordForm.attributes} onChange={(e) => setRecordForm({ ...recordForm, attributes: e.target.value })} /></label>
          <div className="btn-row"><button className="btn-primary" disabled={busy !== ""}>{recordForm.id ? "Save catalog record" : "Add catalog record"}</button>{recordForm.id ? <button type="button" onClick={() => setRecordForm({ id: "", recordType: "system", key: "", name: "", summary: "", sensitivity: "internal", attributes: "{}" })}>Cancel edit</button> : null}</div>
        </form>
        <div className="table-wrap"><table><thead><tr><th>Record</th><th>Type</th><th>Status</th><th>Verification</th><th>Details</th></tr></thead><tbody>
          {(data?.records ?? []).map((record) => <tr key={record.id}><td><strong>{record.name}</strong><div className="mono small muted">{record.key} · {record.id}</div>{record.summary ? <div className="small">{record.summary}</div> : null}</td><td>{record.recordType}</td><td><Badge value={record.lifecycle} /></td><td><Badge value={record.verificationState} /></td><td><JsonDetails label="Attributes" value={record.attributes} /><button type="button" className="btn-small" onClick={() => setRecordForm({ id: record.id, recordType: record.recordType, key: record.key, name: record.name, summary: record.summary ?? "", sensitivity: record.sensitivity, attributes: JSON.stringify(record.attributes, null, 2) })}>Edit</button></td></tr>)}
        </tbody></table></div>
      </div>

      <div className="card">
        <h2>Ownership and lineage</h2>
        <form onSubmit={(event) => void createRelationship(event)}>
          <div className="form-grid">
            <label>From<select required value={relationshipForm.fromRecordId} onChange={(e) => setRelationshipForm({ ...relationshipForm, fromRecordId: e.target.value })}><option value="">Select…</option>{(data?.records ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.recordType})</option>)}</select></label>
            <label>Relationship<input required value={relationshipForm.relationshipType} onChange={(e) => setRelationshipForm({ ...relationshipForm, relationshipType: e.target.value })} list="relationship-types" /><datalist id="relationship-types"><option value="owns"/><option value="operates"/><option value="approves"/><option value="backup_for"/><option value="member_of"/><option value="agency_for"/><option value="vendor_for"/><option value="account_of"/><option value="integrates_with"/><option value="upstream_of"/><option value="downstream_of"/><option value="documented_by"/><option value="consumes"/><option value="produces"/><option value="escalates_to"/></datalist></label>
            <label>To<select required value={relationshipForm.toRecordId} onChange={(e) => setRelationshipForm({ ...relationshipForm, toRecordId: e.target.value })}><option value="">Select…</option>{(data?.records ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.recordType})</option>)}</select></label>
          </div>
          <div className="btn-row"><button className="btn-primary" disabled={busy !== ""}>Save relationship</button></div>
        </form>
      </div>

      <div className="card">
        <h2>Source connectors</h2>
        <form onSubmit={(event) => void createConnector(event)}>
          <div className="form-grid">
            <label>Connector key<input required value={connectorForm.key} onChange={(e) => setConnectorForm({ ...connectorForm, key: e.target.value })} placeholder="notion_gtm_systems" /></label>
            <label>Name<input required value={connectorForm.name} onChange={(e) => setConnectorForm({ ...connectorForm, name: e.target.value })} /></label>
            <label>Notion data source ID<input required value={connectorForm.dataSourceId} onChange={(e) => setConnectorForm({ ...connectorForm, dataSourceId: e.target.value })} /></label>
            <label>Catalog record type<select value={connectorForm.recordType} onChange={(e) => setConnectorForm({ ...connectorForm, recordType: e.target.value })}>{RECORD_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Title property<input value={connectorForm.titleProperty} onChange={(e) => setConnectorForm({ ...connectorForm, titleProperty: e.target.value })} /></label>
            <label>Key property<input value={connectorForm.keyProperty} onChange={(e) => setConnectorForm({ ...connectorForm, keyProperty: e.target.value })} /></label>
            <label>Summary property<input value={connectorForm.summaryProperty} onChange={(e) => setConnectorForm({ ...connectorForm, summaryProperty: e.target.value })} /></label>
            <label>Scan interval (minutes)<input type="number" min="5" value={connectorForm.scheduleMinutes} onChange={(e) => setConnectorForm({ ...connectorForm, scheduleMinutes: e.target.value })} /></label>
          </div>
          <label>Notion property → catalog attribute mapping (JSON)<textarea className="mono" value={connectorForm.attributeMap} onChange={(e) => setConnectorForm({ ...connectorForm, attributeMap: e.target.value })} placeholder={'{"Account ID":"accountId","CSM":"csm"}'} /></label>
          <div className="btn-row"><button className="btn-primary" disabled={busy !== ""}>Create paused connector</button></div>
        </form>
        <div className="table-wrap"><table><thead><tr><th>Connector</th><th>Mode</th><th>Last success</th><th>Error</th><th>Actions</th></tr></thead><tbody>
          {(data?.connectors ?? []).map((connector) => <tr key={connector.id}><td><strong>{connector.name}</strong><div className="mono small muted">{connector.key}</div><JsonDetails label="Mapping" value={connector.config} /></td><td><Badge value={connector.status} /> {connector.mode} / {connector.scheduleMinutes} min<div className="small">Auto-apply: {connector.autoApply ? `yes (${connector.authoritativeFields.join(", ")})` : "off"}</div></td><td className="small nowrap">{fmtDateTime(connector.lastSucceededAt)}</td><td className="small">{connector.lastError ?? "—"}</td><td><ConnectorControls connector={connector} busy={busy !== ""} onRun={async () => { await act("run_connector", { connectorId: connector.id }, `Scan finished for ${connector.name}.`); }} onSave={async (updated) => { await act("upsert_connector", { connector: updated, reason: "Connector controls updated in GTM Data MCP admin" }, "Connector controls saved."); }} /></td></tr>)}
          {(data?.connectors.length ?? 0) === 0 ? <tr><td colSpan={5} className="muted">No connectors configured.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card">
        <h2>Detected updates</h2>
        <label>Decision reason<input value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="Required for approve or reject" /></label>
        <div className="table-wrap"><table><thead><tr><th>Proposal</th><th>Source</th><th>Difference</th><th>Status</th><th>Decision</th></tr></thead><tbody>
          {(data?.updates ?? []).map(({ proposal, connector, source }) => <tr key={proposal.id}><td><span className="mono small">{proposal.id}</span><div>{proposal.proposalType}</div><div className="small muted">{fmtDateTime(proposal.createdAt)}</div></td><td>{connector.name}<div className="mono small muted">{source.externalId}</div>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}</td><td><JsonDetails label="Review diff" value={proposal.diff} /></td><td><Badge value={proposal.status} /></td><td>{proposal.status === "pending" ? <div className="btn-row" style={{ margin: 0 }}><button type="button" className="btn-small" disabled={busy !== "" || !reviewReason.trim()} onClick={() => void act("decide_update", { proposalId: proposal.id, decision: "approve", reason: reviewReason }, "Source update approved and applied.")}>Approve</button><button type="button" className="btn-small" disabled={busy !== "" || !reviewReason.trim()} onClick={() => void act("decide_update", { proposalId: proposal.id, decision: "reject", reason: reviewReason }, "Source update rejected.")}>Reject</button></div> : "—"}</td></tr>)}
          {(data?.updates.length ?? 0) === 0 ? <tr><td colSpan={5} className="muted">No source updates detected.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card">
        <h2>Bulk-change templates ({data?.templates.length ?? 0})</h2>
        <p className="small muted">Draft platform templates are starting points. Verify them against a current platform export before upload.</p>
        <div className="table-wrap"><table><thead><tr><th>Template</th><th>Platform / operation</th><th>Status</th><th>Constraints</th><th>Actions</th></tr></thead><tbody>
          {(data?.templates ?? []).map((template) => <tr key={template.id}><td><strong>{template.name}</strong><div className="mono small muted">{template.key}</div></td><td>{template.platformKey}<div className="small">{template.operation}</div></td><td><Badge value={template.verificationState} /></td><td className="small">{template.availabilityNotes ?? "—"}{template.docsUrl ? <div><a href={template.docsUrl} target="_blank" rel="noreferrer">Official documentation</a></div> : null}</td><td><TemplateControls template={template} busy={busy !== ""} onDownload={async () => { await downloadTemplate(template); }} onSave={async (verificationState, lifecycle) => { await act("upsert_template", { template: { ...template, verificationState, lifecycle }, reason: "Template controls updated in GTM Data MCP admin" }, "Template controls saved."); }} /></td></tr>)}
        </tbody></table></div>
      </div>

      <div className="card">
        <h2>Recent source scans</h2>
        <div className="table-wrap"><table><thead><tr><th>Connector</th><th>Status</th><th>Trigger</th><th>Seen</th><th>Changed</th><th>Proposed</th><th>Applied</th><th>When</th></tr></thead><tbody>
          {(data?.syncRuns ?? []).map((run) => <tr key={run.id}><td>{connectorNames.get(run.connectorId) ?? run.connectorId}</td><td><Badge value={run.status} />{run.error ? <div className="small">{run.error}</div> : null}</td><td>{run.trigger}</td><td>{run.seenCount}</td><td>{run.changedCount}</td><td>{run.proposedCount}</td><td>{run.appliedCount}</td><td className="small nowrap">{fmtDateTime(run.startedAt)}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}
