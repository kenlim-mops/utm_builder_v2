"use client";

/**
 * Admin: platform presets. Structured fields (defaults, macros, required
 * fields) are edited as labeled JSON/CSV-ish inputs and validated before
 * posting to /api/admin/presets.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Msg } from "../../components";
import { api, errText, type Preset } from "../../lib";

interface PresetEdit {
  verificationState: "draft" | "verified" | "deprecated";
  docsUrl: string;
  defaultsJson: string;
  macros: string; // comma-separated
  requiredFields: string; // comma-separated
}

export default function AdminPresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [edits, setEdits] = useState<Record<string, PresetEdit>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ presets: Preset[] }>("/api/presets");
      setPresets(d.presets);
      setEdits(
        Object.fromEntries(
          d.presets.map((p) => [
            p.key,
            {
              verificationState: p.verificationState,
              docsUrl: p.docsUrl ?? "",
              defaultsJson: JSON.stringify(p.defaults ?? {}),
              macros: (p.supportedMacros ?? []).join(", "),
              requiredFields: (p.requiredFields ?? []).join(", "),
            },
          ]),
        ),
      );
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: string) => {
      const edit = edits[key];
      if (!edit) return;
      let defaults: Record<string, string>;
      try {
        const parsed: unknown = JSON.parse(edit.defaultsJson || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        defaults = parsed as Record<string, string>;
      } catch {
        setError(`Defaults for "${key}" must be a JSON object like {"utm_medium":"cpc"}.`);
        return;
      }
      setSaving(key);
      setError("");
      setNotice("");
      try {
        await api("/api/admin/presets", {
          method: "POST",
          body: JSON.stringify({
            key,
            verificationState: edit.verificationState,
            docsUrl: edit.docsUrl.trim() || null,
            defaults,
            supportedMacros: edit.macros.split(",").map((m) => m.trim()).filter(Boolean),
            requiredFields: edit.requiredFields.split(",").map((f) => f.trim()).filter(Boolean),
            reason: reason.trim() || undefined,
          }),
        });
        setNotice(`Preset "${key}" saved.`);
        await load();
      } catch (err) {
        setError(errText(err));
      } finally {
        setSaving("");
      }
    },
    [edits, reason, load],
  );

  return (
    <div>
      <h1>Platform presets</h1>
      <p className="page-sub">
        Per-platform defaults and rules applied at preview/issuance time. Changes bump the config
        version.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <div className="field">
          <label htmlFor="preset-reason">
            Change reason <span className="hint">(applied to every save on this page)</span>
          </label>
          <input
            id="preset-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      {presets.map((p) => {
        const edit = edits[p.key];
        if (!edit) return null;
        return (
          <div className="card" key={p.key}>
            <h2>
              {p.name} <span className="mono small">({p.key})</span>{" "}
              <Badge value={edit.verificationState} />
            </h2>
            <p className="small muted">
              Output type: <span className="mono">{p.outputType}</span> · version {p.version}
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`vs-${p.key}`}>Verification state</label>
                <select
                  id={`vs-${p.key}`}
                  value={edit.verificationState}
                  onChange={(e) =>
                    setEdits((cur) => ({
                      ...cur,
                      [p.key]: { ...edit, verificationState: e.target.value as PresetEdit["verificationState"] },
                    }))
                  }
                >
                  <option value="draft">draft</option>
                  <option value="verified">verified</option>
                  <option value="deprecated">deprecated</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`docs-${p.key}`}>Docs URL</label>
                <input
                  id={`docs-${p.key}`}
                  type="url"
                  value={edit.docsUrl}
                  onChange={(e) => setEdits((cur) => ({ ...cur, [p.key]: { ...edit, docsUrl: e.target.value } }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor={`defaults-${p.key}`}>
                Defaults <span className="hint">(JSON object, e.g. {"{"}&quot;utm_medium&quot;: &quot;cpc&quot;{"}"})</span>
              </label>
              <input
                id={`defaults-${p.key}`}
                type="text"
                className="mono"
                value={edit.defaultsJson}
                onChange={(e) =>
                  setEdits((cur) => ({ ...cur, [p.key]: { ...edit, defaultsJson: e.target.value } }))
                }
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`macros-${p.key}`}>
                  Supported macros <span className="hint">(comma-separated)</span>
                </label>
                <input
                  id={`macros-${p.key}`}
                  type="text"
                  className="mono"
                  value={edit.macros}
                  onChange={(e) => setEdits((cur) => ({ ...cur, [p.key]: { ...edit, macros: e.target.value } }))}
                />
              </div>
              <div className="field">
                <label htmlFor={`required-${p.key}`}>
                  Required fields <span className="hint">(comma-separated, e.g. utm_content)</span>
                </label>
                <input
                  id={`required-${p.key}`}
                  type="text"
                  className="mono"
                  value={edit.requiredFields}
                  onChange={(e) =>
                    setEdits((cur) => ({ ...cur, [p.key]: { ...edit, requiredFields: e.target.value } }))
                  }
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary btn-small"
              disabled={saving === p.key}
              onClick={() => void save(p.key)}
            >
              {saving === p.key ? "Saving…" : "Save preset"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
