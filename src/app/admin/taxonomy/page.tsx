"use client";

/** Admin: governed mediums and sources with inline edit + add forms. */
import { useCallback, useEffect, useState } from "react";
import { Badge, Msg } from "../../components";
import { api, errText, type Taxonomy, type TaxonomyMedium, type TaxonomySource } from "../../lib";

type Status = "active" | "deprecated" | "disabled";
const STATUSES: Status[] = ["active", "deprecated", "disabled"];

interface MediumEdit {
  label: string;
  status: Status;
}

interface SourceEdit {
  label: string;
  mediumSlug: string;
  status: Status;
  aliases: string; // comma-separated for editing
}

export default function AdminTaxonomyPage() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ mediums: [], sources: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  const [mediumEdits, setMediumEdits] = useState<Record<string, MediumEdit>>({});
  const [sourceEdits, setSourceEdits] = useState<Record<string, SourceEdit>>({});
  const [reason, setReason] = useState("");

  const [newMedium, setNewMedium] = useState({ slug: "", label: "" });
  const [newSource, setNewSource] = useState({ slug: "", mediumSlug: "", label: "", aliases: "" });

  const load = useCallback(async () => {
    try {
      const d = await api<Taxonomy>("/api/taxonomy");
      setTaxonomy(d);
      setMediumEdits(
        Object.fromEntries(d.mediums.map((m) => [m.slug, { label: m.label, status: m.status }])),
      );
      setSourceEdits(
        Object.fromEntries(
          d.sources.map((s) => [
            s.slug,
            {
              label: s.label,
              mediumSlug: s.mediumSlug,
              status: s.status,
              aliases: (s.aliases ?? []).join(", "),
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

  const post = useCallback(
    async (payload: Record<string, unknown>, savingKey: string, successMsg: string) => {
      setSaving(savingKey);
      setError("");
      setNotice("");
      try {
        await api("/api/admin/taxonomy", {
          method: "POST",
          body: JSON.stringify({ ...payload, reason: reason.trim() || undefined }),
        });
        setNotice(successMsg);
        await load();
      } catch (err) {
        setError(errText(err));
      } finally {
        setSaving("");
      }
    },
    [reason, load],
  );

  const saveMedium = (m: TaxonomyMedium) => {
    const edit = mediumEdits[m.slug];
    if (!edit) return;
    void post(
      { kind: "medium", slug: m.slug, label: edit.label, status: edit.status },
      `medium:${m.slug}`,
      `Medium "${m.slug}" saved.`,
    );
  };

  const saveSource = (s: TaxonomySource) => {
    const edit = sourceEdits[s.slug];
    if (!edit) return;
    void post(
      {
        kind: "source",
        slug: s.slug,
        mediumSlug: edit.mediumSlug,
        label: edit.label,
        status: edit.status,
        aliases: edit.aliases
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter(Boolean),
      },
      `source:${s.slug}`,
      `Source "${s.slug}" saved.`,
    );
  };

  return (
    <div>
      <h1>Taxonomy</h1>
      <p className="page-sub">
        Governed utm_medium and utm_source values. Changes bump the config version and are audited.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <div className="field">
          <label htmlFor="tax-reason">
            Change reason <span className="hint">(applied to every save on this page)</span>
          </label>
          <input
            id="tax-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Deprecating banner in favor of display"
          />
        </div>
      </div>

      <div className="card">
        <h2>Mediums</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Slug</th>
                <th>Label</th>
                <th>Status</th>
                <th>Sort</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {taxonomy.mediums.map((m) => {
                const edit = mediumEdits[m.slug] ?? { label: m.label, status: m.status };
                return (
                  <tr key={m.slug}>
                    <td className="mono">{m.slug}</td>
                    <td>
                      <input
                        type="text"
                        aria-label={`Label for medium ${m.slug}`}
                        value={edit.label}
                        onChange={(e) =>
                          setMediumEdits((cur) => ({ ...cur, [m.slug]: { ...edit, label: e.target.value } }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Status for medium ${m.slug}`}
                        value={edit.status}
                        onChange={(e) =>
                          setMediumEdits((cur) => ({
                            ...cur,
                            [m.slug]: { ...edit, status: e.target.value as Status },
                          }))
                        }
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{m.sortOrder}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-small"
                        disabled={saving === `medium:${m.slug}`}
                        onClick={() => saveMedium(m)}
                      >
                        {saving === `medium:${m.slug}` ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3>Add medium</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-medium-slug">Slug</label>
            <input
              id="new-medium-slug"
              type="text"
              value={newMedium.slug}
              onChange={(e) => setNewMedium((c) => ({ ...c, slug: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="new-medium-label">Label</label>
            <input
              id="new-medium-label"
              type="text"
              value={newMedium.label}
              onChange={(e) => setNewMedium((c) => ({ ...c, label: e.target.value }))}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={!newMedium.slug.trim() || saving === "medium:new"}
          onClick={() => {
            void post(
              {
                kind: "medium",
                slug: newMedium.slug.trim().toLowerCase(),
                label: newMedium.label.trim() || newMedium.slug.trim(),
              },
              "medium:new",
              `Medium "${newMedium.slug}" added.`,
            ).then(() => setNewMedium({ slug: "", label: "" }));
          }}
        >
          Add medium
        </button>
      </div>

      <div className="card">
        <h2>Sources</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Slug</th>
                <th>Label</th>
                <th>Medium</th>
                <th>Aliases (comma-separated)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {taxonomy.sources.map((s) => {
                const edit =
                  sourceEdits[s.slug] ?? {
                    label: s.label,
                    mediumSlug: s.mediumSlug,
                    status: s.status,
                    aliases: (s.aliases ?? []).join(", "),
                  };
                return (
                  <tr key={s.slug}>
                    <td className="mono">{s.slug}</td>
                    <td>
                      <input
                        type="text"
                        aria-label={`Label for source ${s.slug}`}
                        value={edit.label}
                        onChange={(e) =>
                          setSourceEdits((cur) => ({ ...cur, [s.slug]: { ...edit, label: e.target.value } }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Medium for source ${s.slug}`}
                        value={edit.mediumSlug}
                        onChange={(e) =>
                          setSourceEdits((cur) => ({
                            ...cur,
                            [s.slug]: { ...edit, mediumSlug: e.target.value },
                          }))
                        }
                      >
                        {taxonomy.mediums.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.slug}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        aria-label={`Aliases for source ${s.slug}`}
                        value={edit.aliases}
                        onChange={(e) =>
                          setSourceEdits((cur) => ({ ...cur, [s.slug]: { ...edit, aliases: e.target.value } }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Status for source ${s.slug}`}
                        value={edit.status}
                        onChange={(e) =>
                          setSourceEdits((cur) => ({
                            ...cur,
                            [s.slug]: { ...edit, status: e.target.value as Status },
                          }))
                        }
                      >
                        {STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-small"
                        disabled={saving === `source:${s.slug}`}
                        onClick={() => saveSource(s)}
                      >
                        {saving === `source:${s.slug}` ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3>Add source</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-source-slug">Slug</label>
            <input
              id="new-source-slug"
              type="text"
              value={newSource.slug}
              onChange={(e) => setNewSource((c) => ({ ...c, slug: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="new-source-medium">Medium</label>
            <select
              id="new-source-medium"
              value={newSource.mediumSlug}
              onChange={(e) => setNewSource((c) => ({ ...c, mediumSlug: e.target.value }))}
            >
              <option value="">Select…</option>
              {taxonomy.mediums.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.slug}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-source-label">Label</label>
            <input
              id="new-source-label"
              type="text"
              value={newSource.label}
              onChange={(e) => setNewSource((c) => ({ ...c, label: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="new-source-aliases">Aliases (comma-separated)</label>
            <input
              id="new-source-aliases"
              type="text"
              value={newSource.aliases}
              onChange={(e) => setNewSource((c) => ({ ...c, aliases: e.target.value }))}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={!newSource.slug.trim() || !newSource.mediumSlug || saving === "source:new"}
          onClick={() => {
            void post(
              {
                kind: "source",
                slug: newSource.slug.trim().toLowerCase(),
                mediumSlug: newSource.mediumSlug,
                label: newSource.label.trim() || newSource.slug.trim(),
                aliases: newSource.aliases
                  .split(",")
                  .map((a) => a.trim().toLowerCase())
                  .filter(Boolean),
              },
              "source:new",
              `Source "${newSource.slug}" added.`,
            ).then(() => setNewSource({ slug: "", mediumSlug: "", label: "", aliases: "" }));
          }}
        >
          Add source
        </button>
      </div>

      <p className="small muted">
        Status legend: <Badge value="active" /> usable, <Badge value="deprecated" /> warns on use,{" "}
        <Badge value="disabled" /> blocked.
      </p>
    </div>
  );
}
