"use client";

/**
 * Bulk builder: shared fields + editable grid + spreadsheet paste + CSV
 * upload. Parsing an uploaded file for display is a UI concern; issuance
 * always goes through POST /api/batches row-by-row on the server.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, CopyButton, Msg, useSession } from "../components";
import {
  api,
  downloadTextFile,
  errText,
  parseCsv,
  toCsvText,
  type BatchResult,
  type Campaign,
  type Initiative,
  type Preset,
  type Taxonomy,
} from "../lib";

interface GridRow {
  destination: string;
  source: string;
  medium: string;
  content: string;
  term: string;
}

const EMPTY_ROW: GridRow = { destination: "", source: "", medium: "", content: "", term: "" };
const COLUMNS: { key: keyof GridRow; label: string }[] = [
  { key: "destination", label: "Destination" },
  { key: "source", label: "utm_source" },
  { key: "medium", label: "utm_medium" },
  { key: "content", label: "utm_content" },
  { key: "term", label: "utm_term" },
];

export default function BulkPage() {
  const { capabilities } = useSession();
  // Reference data
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ mediums: [], sources: [] });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadError, setLoadError] = useState("");

  // Shared fields applied to every row (row values win where present)
  const [initiativeId, setInitiativeId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [presetKey, setPresetKey] = useState("generic");
  const [sharedMedium, setSharedMedium] = useState("");
  const [sharedSource, setSharedSource] = useState("");

  // Grid
  const [rows, setRows] = useState<GridRow[]>([{ ...EMPTY_ROW }]);
  const [batchSource, setBatchSource] = useState<"grid" | "paste" | "csv">("grid");

  // Paste
  const [pasteText, setPasteText] = useState("");
  const [importInfo, setImportInfo] = useState("");

  // Submit / results
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ini, cam, tax, pre] = await Promise.all([
          api<{ initiatives: Initiative[] }>("/api/initiatives"),
          api<{ campaigns: Campaign[] }>("/api/campaigns"),
          api<Taxonomy>("/api/taxonomy"),
          api<{ presets: Preset[] }>("/api/presets"),
        ]);
        setInitiatives(ini.initiatives);
        setCampaigns(cam.campaigns);
        setTaxonomy(tax);
        setPresets(pre.presets);
      } catch (err) {
        setLoadError(errText(err));
      }
    })();
  }, []);

  const visibleCampaigns = initiativeId
    ? campaigns.filter((c) => c.initiativeId === initiativeId)
    : campaigns;

  const setCell = useCallback((rowIndex: number, key: keyof GridRow, value: string) => {
    setRows((cur) => cur.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r)));
  }, []);

  const addRow = useCallback(() => setRows((cur) => [...cur, { ...EMPTY_ROW }]), []);
  const cloneRow = useCallback(
    (i: number) => setRows((cur) => [...cur.slice(0, i + 1), { ...cur[i] }, ...cur.slice(i + 1)]),
    [],
  );
  const deleteRow = useCallback(
    (i: number) => setRows((cur) => (cur.length > 1 ? cur.filter((_, x) => x !== i) : [{ ...EMPTY_ROW }])),
    [],
  );

  /** Fill the column downward from the first row's value. */
  const fillDown = useCallback((key: keyof GridRow) => {
    setRows((cur) => {
      if (cur.length === 0) return cur;
      const top = cur[0][key];
      return cur.map((r, i) => (i === 0 ? r : { ...r, [key]: top }));
    });
  }, []);

  const importParsedRows = useCallback(
    (parsed: string[][], origin: "paste" | "csv") => {
      // Expected columns: destination, source, medium, content, term.
      // A header row is detected and skipped.
      const body =
        parsed.length > 0 && /^(destination|url)$/i.test(parsed[0][0]?.trim() ?? "")
          ? parsed.slice(1)
          : parsed;
      const mapped: GridRow[] = body
        .filter((cells) => (cells[0] ?? "").trim() !== "")
        .map((cells) => ({
          destination: (cells[0] ?? "").trim(),
          source: (cells[1] ?? "").trim(),
          medium: (cells[2] ?? "").trim(),
          content: (cells[3] ?? "").trim(),
          term: (cells[4] ?? "").trim(),
        }));
      if (mapped.length === 0) {
        setImportInfo("Nothing to import — no rows with a destination found.");
        return;
      }
      setRows((cur) => {
        const existing = cur.filter((r) => Object.values(r).some((v) => v.trim() !== ""));
        return [...existing, ...mapped];
      });
      setBatchSource(origin);
      setImportInfo(`Imported ${mapped.length} row${mapped.length === 1 ? "" : "s"} from ${origin === "csv" ? "CSV file" : "pasted data"}.`);
    },
    [],
  );

  const importPaste = useCallback(() => {
    const parsed = pasteText
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => line.split("\t"));
    importParsedRows(parsed, "paste");
    setPasteText("");
  }, [pasteText, importParsedRows]);

  const importCsvFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        importParsedRows(parseCsv(String(reader.result ?? "")), "csv");
      };
      reader.onerror = () => setImportInfo("Could not read the file.");
      reader.readAsText(file);
    },
    [importParsedRows],
  );

  const effectiveRows = useMemo(
    () => rows.filter((r) => r.destination.trim() !== ""),
    [rows],
  );

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError("");
    setResult(null);
    try {
      const payload = {
        source: batchSource,
        rows: effectiveRows.map((r) => ({
          destination: r.destination.trim(),
          campaignId,
          presetKey: presetKey || undefined,
          utmSource: r.source.trim() || sharedSource,
          utmMedium: r.medium.trim() || sharedMedium,
          utmContent: r.content.trim() || undefined,
          utmTerm: r.term.trim() || undefined,
        })),
      };
      const d = await api<BatchResult>("/api/batches", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setResult(d);
    } catch (err) {
      setSubmitError(errText(err));
    } finally {
      setSubmitting(false);
    }
  }, [batchSource, effectiveRows, campaignId, presetKey, sharedSource, sharedMedium]);

  const exportResultsCsv = useCallback(() => {
    if (!result) return;
    const csv = toCsvText([
      ["row", "status", "link_id", "final_url", "errors"],
      ...result.rows.map((r) => [
        r.rowIndex + 1,
        r.status,
        r.linkId,
        r.finalUrl,
        r.errors.map((e) => `${e.code}: ${e.message}`).join("; "),
      ]),
    ]);
    downloadTextFile(`batch-${result.batchId}.csv`, csv);
  }, [result]);

  const visibleResults = result
    ? exceptionsOnly
      ? result.rows.filter((r) => r.status !== "issued")
      : result.rows
    : [];

  return (
    <div>
      <h1>Bulk Builder</h1>
      <p className="page-sub">
        Issue many links in one governed batch. Each row goes through the same validation and
        duplicate checks as the single builder.
      </p>
      <Msg kind="error">{loadError}</Msg>

      <div className="card">
        <h2>Shared fields</h2>
        <p className="hint">
          Applied to every row. A row&apos;s own source/medium value wins over the shared one.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="bulk-initiative">Initiative</label>
            <select
              id="bulk-initiative"
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
          </div>
          <div className="field">
            <label htmlFor="bulk-campaign">Campaign (required)</label>
            <select
              id="bulk-campaign"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">Select a campaign…</option>
              {visibleCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.utmCampaign})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bulk-preset">Platform preset</label>
            <select id="bulk-preset" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bulk-medium">Default utm_medium</label>
            <select
              id="bulk-medium"
              value={sharedMedium}
              onChange={(e) => setSharedMedium(e.target.value)}
            >
              <option value="">None</option>
              {taxonomy.mediums
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.label} ({m.slug})
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bulk-source">Default utm_source</label>
            <select
              id="bulk-source"
              value={sharedSource}
              onChange={(e) => setSharedSource(e.target.value)}
            >
              <option value="">None</option>
              {taxonomy.sources
                .filter((s) => s.status === "active" && (!sharedMedium || s.mediumSlug === sharedMedium))
                .map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label} ({s.slug})
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Rows</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="nowrap">#</th>
                {COLUMNS.map((c) => (
                  <th key={c.key}>
                    {c.label}{" "}
                    <button
                      type="button"
                      className="btn-small"
                      title={`Fill ${c.label} down from row 1`}
                      onClick={() => fillDown(c.key)}
                    >
                      Fill ↓
                    </button>
                  </th>
                ))}
                <th className="nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="nowrap">{i + 1}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key}>
                      <input
                        type="text"
                        className="grid-input"
                        aria-label={`Row ${i + 1} ${c.label}`}
                        value={row[c.key]}
                        placeholder={
                          c.key === "source" && sharedSource
                            ? sharedSource
                            : c.key === "medium" && sharedMedium
                              ? sharedMedium
                              : ""
                        }
                        onChange={(e) => setCell(i, c.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="nowrap">
                    <button type="button" className="btn-small" onClick={() => cloneRow(i)}>
                      Clone
                    </button>{" "}
                    <button type="button" className="btn-small btn-danger" onClick={() => deleteRow(i)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button type="button" onClick={addRow}>
            + Add row
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!capabilities.canWrite || submitting || !campaignId || effectiveRows.length === 0}
            onClick={() => void submit()}
          >
            {submitting
              ? "Submitting batch…"
              : `Submit batch (${effectiveRows.length} row${effectiveRows.length === 1 ? "" : "s"})`}
          </button>
          {!campaignId ? <span className="hint">Select a campaign to enable submission.</span> : null}
        </div>
        <Msg kind="error">{submitError}</Msg>
        {!capabilities.canWrite ? (
          <Msg kind="info">Read-only access: bulk issuance is unavailable for your role.</Msg>
        ) : null}
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Paste from spreadsheet</h2>
          <div className="field">
            <label htmlFor="paste-area">
              Tab-separated rows <span className="hint">(columns: destination, source, medium, content, term)</span>
            </label>
            <textarea
              id="paste-area"
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"https://runpod.io/a\tgoogle\tcpc\nhttps://runpod.io/b\tlinkedin\tpaid-social"}
            />
          </div>
          <button type="button" disabled={!pasteText.trim()} onClick={importPaste}>
            Add pasted rows to grid
          </button>
        </div>

        <div className="card">
          <h2>CSV upload</h2>
          <div className="field">
            <label htmlFor="csv-file">
              CSV file <span className="hint">(columns: destination, source, medium, content, term)</span>
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => importCsvFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="hint">
            The file is parsed locally for display only — every row is validated and issued by the
            registry API.
          </p>
        </div>
      </div>
      <Msg kind="info">{importInfo}</Msg>

      {result ? (
        <div className="card">
          <h2>
            Batch results <Badge value={result.status} />
          </h2>
          <p>
            Batch <span className="mono">{result.batchId}</span> — {result.succeeded} succeeded,{" "}
            {result.failed} failed or skipped.
          </p>
          <div className="btn-row">
            <label className="checkbox-label" htmlFor="exceptions-only" style={{ margin: 0 }}>
              <input
                id="exceptions-only"
                type="checkbox"
                checked={exceptionsOnly}
                onChange={(e) => setExceptionsOnly(e.target.checked)}
              />
              Exceptions only
            </label>
            <button type="button" onClick={exportResultsCsv}>
              Export results CSV
            </button>
            <a className="btn" href={`/api/export/links?batchId=${encodeURIComponent(result.batchId)}`}>
              Export issued links CSV
            </a>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Link</th>
                  <th>Final URL</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {visibleResults.map((r) => (
                  <tr key={r.rowIndex}>
                    <td>{r.rowIndex + 1}</td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td className="nowrap">
                      {r.linkId ? (
                        <Link href={`/registry/links/${r.linkId}`} className="mono small">
                          {r.linkId}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {r.finalUrl ? (
                        <>
                          <span className="url-cell mono small">{r.finalUrl}</span>{" "}
                          <CopyButton text={r.finalUrl} />
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {r.errors.length ? (
                        <ul className="findings">
                          {r.errors.map((e, x) => (
                            <li key={x} className="finding-error">
                              <span className="mono">{e.code}</span>: {e.message}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleResults.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No rows match the current filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
