"use client";

/**
 * Admin: link policy & limits. Each section saves one settings key via
 * POST /api/admin/settings {key, value, reason}.
 */
import { useCallback, useEffect, useState } from "react";
import { Msg } from "../../components";
import { api, errText, type AppConfig } from "../../lib";

export default function AdminPolicyPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");
  const [reason, setReason] = useState("");

  // Local editable copies
  const [rpLinkId, setRpLinkId] = useState(true);
  const [rpInitiativeId, setRpInitiativeId] = useState(false);
  const [bulkLimit, setBulkLimit] = useState("200");
  const [requireContent, setRequireContent] = useState(false);
  const [requireTerm, setRequireTerm] = useState(false);
  const [maxUrlLength, setMaxUrlLength] = useState("900");

  const load = useCallback(async () => {
    try {
      const d = await api<{ config: AppConfig }>("/api/admin/settings");
      setConfig(d.config);
      setRpLinkId(d.config.publicParamPolicy.rp_link_id);
      setRpInitiativeId(d.config.publicParamPolicy.rp_initiative_id);
      setBulkLimit(String(d.config.bulkLimit));
      setRequireContent(d.config.requiredFields.includes("utm_content"));
      setRequireTerm(d.config.requiredFields.includes("utm_term"));
      setMaxUrlLength(String(d.config.recommendedMaxUrlLength));
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: string, value: unknown, label: string) => {
      setSaving(key);
      setError("");
      setNotice("");
      try {
        await api("/api/admin/settings", {
          method: "POST",
          body: JSON.stringify({ key, value, reason: reason.trim() || undefined }),
        });
        setNotice(`${label} saved.`);
        await load();
      } catch (err) {
        setError(errText(err));
      } finally {
        setSaving("");
      }
    },
    [reason, load],
  );

  return (
    <div>
      <h1>Policy &amp; limits</h1>
      <p className="page-sub">
        {config ? `Configuration version v${config.configVersion}. ` : ""}
        Every save bumps the config version and is audited with the reason below.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <div className="field">
          <label htmlFor="policy-reason">
            Change reason <span className="hint">(recorded with each save)</span>
          </label>
          <input
            id="policy-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Enabling initiative attribution for Q4"
          />
        </div>
      </div>

      <div className="card">
        <h2>Public URL parameters</h2>
        <p className="hint">Controls which registry IDs are emitted on issued URLs.</p>
        <label className="checkbox-label" htmlFor="pp-link">
          <input
            id="pp-link"
            type="checkbox"
            checked={rpLinkId}
            onChange={(e) => setRpLinkId(e.target.checked)}
          />
          Emit <span className="mono">rp_link_id</span> on final URLs
        </label>
        <label className="checkbox-label" htmlFor="pp-initiative">
          <input
            id="pp-initiative"
            type="checkbox"
            checked={rpInitiativeId}
            onChange={(e) => setRpInitiativeId(e.target.checked)}
          />
          Emit <span className="mono">rp_initiative_id</span> on final URLs
        </label>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={saving === "public_param_policy"}
          onClick={() =>
            void save(
              "public_param_policy",
              { rp_link_id: rpLinkId, rp_initiative_id: rpInitiativeId },
              "Public param policy",
            )
          }
        >
          {saving === "public_param_policy" ? "Saving…" : "Save public param policy"}
        </button>
      </div>

      <div className="card">
        <h2>Bulk limit</h2>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="bulk-limit">Max rows per batch</label>
          <input
            id="bulk-limit"
            type="number"
            min={1}
            value={bulkLimit}
            onChange={(e) => setBulkLimit(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={saving === "bulk_limit" || !Number.isFinite(Number(bulkLimit)) || Number(bulkLimit) < 1}
          onClick={() => void save("bulk_limit", Number(bulkLimit), "Bulk limit")}
        >
          {saving === "bulk_limit" ? "Saving…" : "Save bulk limit"}
        </button>
      </div>

      <div className="card">
        <h2>Required fields</h2>
        <p className="hint">Fields that must be provided on every link, beyond the core set.</p>
        <label className="checkbox-label" htmlFor="rf-content">
          <input
            id="rf-content"
            type="checkbox"
            checked={requireContent}
            onChange={(e) => setRequireContent(e.target.checked)}
          />
          Require <span className="mono">utm_content</span>
        </label>
        <label className="checkbox-label" htmlFor="rf-term">
          <input
            id="rf-term"
            type="checkbox"
            checked={requireTerm}
            onChange={(e) => setRequireTerm(e.target.checked)}
          />
          Require <span className="mono">utm_term</span>
        </label>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={saving === "required_fields"}
          onClick={() =>
            void save(
              "required_fields",
              [...(requireContent ? ["utm_content"] : []), ...(requireTerm ? ["utm_term"] : [])],
              "Required fields",
            )
          }
        >
          {saving === "required_fields" ? "Saving…" : "Save required fields"}
        </button>
      </div>

      <div className="card">
        <h2>Recommended max URL length</h2>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="max-url">Characters (warning threshold)</label>
          <input
            id="max-url"
            type="number"
            min={100}
            value={maxUrlLength}
            onChange={(e) => setMaxUrlLength(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={
            saving === "recommended_max_url_length" ||
            !Number.isFinite(Number(maxUrlLength)) ||
            Number(maxUrlLength) < 100
          }
          onClick={() =>
            void save("recommended_max_url_length", Number(maxUrlLength), "Recommended max URL length")
          }
        >
          {saving === "recommended_max_url_length" ? "Saving…" : "Save max URL length"}
        </button>
      </div>
    </div>
  );
}
