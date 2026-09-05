"use client";

/** Initiatives: list + create. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Msg, useSession } from "../components";
import { api, errText, fmtDate, type Initiative } from "../lib";

export default function InitiativesPage() {
  const { capabilities } = useSession();
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [initiativeType, setInitiativeType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ initiatives: Initiative[] }>("/api/initiatives");
      setInitiatives(d.initiatives);
      setError("");
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError("");
    setNotice("");
    try {
      const d = await api<{ initiative: Initiative }>("/api/initiatives", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          product: product.trim() || undefined,
          initiativeType: initiativeType || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          description: description.trim() || undefined,
        }),
      });
      setNotice(`Initiative "${d.initiative.name}" created (${d.initiative.id}).`);
      setName("");
      setProduct("");
      setInitiativeType("");
      setStartDate("");
      setEndDate("");
      setDescription("");
      await load();
    } catch (err) {
      setCreateError(errText(err));
    } finally {
      setCreating(false);
    }
  }, [name, product, initiativeType, startDate, endDate, description, load]);

  return (
    <div>
      <h1>Initiatives</h1>
      <p className="page-sub">Strategic groupings that campaigns and links roll up to.</p>

      {capabilities.canCreateInitiative ? <div className="card">
        <h2>Create initiative</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ini-name">Name (required)</label>
            <input id="ini-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ini-product">Product</label>
            <input
              id="ini-product"
              type="text"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ini-type">Type</label>
            <select
              id="ini-type"
              value={initiativeType}
              onChange={(e) => setInitiativeType(e.target.value)}
            >
              <option value="">—</option>
              <option value="launch">Launch</option>
              <option value="gtm-motion">GTM motion</option>
              <option value="evergreen">Evergreen</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ini-start">Start date</label>
            <input
              id="ini-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ini-end">End date</label>
            <input id="ini-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ini-desc">Description</label>
          <textarea
            id="ini-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={creating || !name.trim()}
          onClick={() => void create()}
        >
          {creating ? "Creating…" : "Create initiative"}
        </button>
        <Msg kind="error">{createError}</Msg>
        <Msg kind="success">{notice}</Msg>
      </div> : (
        <Msg kind="info">Read-only access: you can browse initiatives, but cannot create them.</Msg>
      )}

      <Msg kind="error">{error}</Msg>
      {loading ? <p aria-live="polite">Loading initiatives…</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>ID</th>
              <th>Product</th>
              <th>Type</th>
              <th>Lifecycle</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {initiatives.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/initiatives/${i.id}`}>{i.name}</Link>
                </td>
                <td className="mono small">{i.id}</td>
                <td>{i.product ?? <span className="muted">—</span>}</td>
                <td>{i.initiativeType ?? <span className="muted">—</span>}</td>
                <td>
                  <Badge value={i.lifecycle} />
                </td>
                <td className="nowrap small">{fmtDate(i.startDate)}</td>
                <td className="nowrap small">{fmtDate(i.endDate)}</td>
              </tr>
            ))}
            {!loading && initiatives.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No initiatives yet — create one above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
