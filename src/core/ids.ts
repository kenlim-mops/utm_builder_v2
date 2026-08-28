/**
 * Canonical Runpod identifier scheme.
 *
 * All public identifiers are prefixed ULIDs (128-bit, non-sequential in the
 * database-identity sense, collision-resistant, lexicographically sortable by
 * creation time). Database sequence IDs are never exposed.
 *
 * Prefixes:
 *   rpi_  initiative
 *   rpc_  campaign (carried publicly in utm_id)
 *   rpl_  link
 *   rpb_  batch
 *   rpr_  revision
 *   rpv_  validation run
 *   rpa_  audit event
 *   rpu_  user
 *   rpo_  outbox event
 *   rpx_  reconciliation run
 */
import { ulid } from "ulidx";

export const ID_PREFIXES = {
  initiative: "rpi",
  campaign: "rpc",
  link: "rpl",
  batch: "rpb",
  revision: "rpr",
  validation: "rpv",
  audit: "rpa",
  user: "rpu",
  outbox: "rpo",
  reconciliation: "rpx",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${ulid()}`;
}

/** ULID with an arbitrary prefix, for internal (non-public) row identities. */
export function prefixedUlid(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export function isValidId(kind: IdKind, value: string): boolean {
  const prefix = `${ID_PREFIXES[kind]}_`;
  if (!value.startsWith(prefix)) return false;
  return ULID_RE.test(value.slice(prefix.length));
}

export function idKindOf(value: string): IdKind | null {
  const m = /^(rp[a-z])_([0-9A-HJKMNP-TV-Z]{26})$/.exec(value);
  if (!m) return null;
  const entry = Object.entries(ID_PREFIXES).find(([, p]) => p === m[1]);
  return entry ? (entry[0] as IdKind) : null;
}
