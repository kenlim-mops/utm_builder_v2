"use client";

/**
 * Admin home: config summary + navigation cards. Access is displayed
 * client-side for convenience, but every admin API enforces the role
 * server-side (403 otherwise).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Msg, useSession } from "../components";
import { api, errText, type AppConfig } from "../lib";

const SECTIONS: { href: string; title: string; desc: string }[] = [
  {
    href: "/admin/taxonomy",
    title: "Taxonomy",
    desc: "Governed utm_medium and utm_source values, aliases, and lifecycle.",
  },
  {
    href: "/admin/presets",
    title: "Platform presets",
    desc: "Per-platform defaults, macros, required fields, and verification state.",
  },
  {
    href: "/admin/destinations",
    title: "Destination policies",
    desc: "Approved domains and exceptions for link destinations.",
  },
  {
    href: "/admin/policy",
    title: "Policy & limits",
    desc: "Public URL params, bulk limits, required fields, URL length guidance.",
  },
  {
    href: "/admin/users",
    title: "Users & roles",
    desc: "Role assignments (user / admin / investigator) and account status.",
  },
  {
    href: "/admin/integrations",
    title: "Integrations",
    desc: "Outbox queue, retries, and registry reconciliation runs.",
  },
  {
    href: "/admin/gtm-data",
    title: "GTM Data MCP",
    desc: "People, ownership, systems, accounts, definitions, runbooks, bulk templates, and source reconciliation.",
  },
  {
    href: "/admin/audit",
    title: "Audit log",
    desc: "Append-only record of every material action (investigator-readable).",
  },
];

export default function AdminHomePage() {
  const { session, loading } = useSession();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api<{ config: AppConfig }>("/api/admin/settings");
        setConfig(d.config);
      } catch (err) {
        setError(errText(err));
      }
    })();
  }, []);

  return (
    <div>
      <h1>Admin</h1>
      <p className="page-sub">Governance configuration for the UTM registry.</p>

      {!loading && session && session.role === "user" ? (
        <Msg kind="info">
          You are signed in as a standard user — these pages are read-blocked by the server (403).
          Switch to the dev-admin identity in the top-right to administer.
        </Msg>
      ) : null}
      <Msg kind="error">{error}</Msg>

      {config ? (
        <div className="card">
          <h2>Current configuration (v{config.configVersion})</h2>
          <div className="table-wrap">
            <table className="kv-table">
              <tbody>
                <tr>
                  <th scope="row">rp_link_id on URLs</th>
                  <td>{config.publicParamPolicy.rp_link_id ? "Enabled" : "Disabled"}</td>
                </tr>
                <tr>
                  <th scope="row">rp_initiative_id on URLs</th>
                  <td>{config.publicParamPolicy.rp_initiative_id ? "Enabled" : "Disabled"}</td>
                </tr>
                <tr>
                  <th scope="row">Bulk limit</th>
                  <td>{config.bulkLimit} rows per batch</td>
                </tr>
                <tr>
                  <th scope="row">Required fields</th>
                  <td>
                    {config.requiredFields.length ? config.requiredFields.join(", ") : "None beyond core"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Duplicate override roles</th>
                  <td>{config.duplicateOverrideRoles.join(", ")}</td>
                </tr>
                <tr>
                  <th scope="row">Recommended max URL length</th>
                  <td>{config.recommendedMaxUrlLength} characters</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <a className="btn" href="/api/admin/export">
              Download config backup (JSON)
            </a>
          </div>
        </div>
      ) : null}

      <div className="card-grid">
        {SECTIONS.map((s) => (
          <div className="card" key={s.href}>
            <h3>
              <Link href={s.href}>{s.title}</Link>
            </h3>
            <p className="small muted" style={{ margin: 0 }}>
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
