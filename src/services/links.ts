/**
 * The single authoritative link-generation service.
 *
 * Every entry point (single builder, bulk grid, CSV upload, spreadsheet paste,
 * future browser helper / platform integrations) calls previewLink/issueLink —
 * there is exactly one implementation of normalization, validation,
 * fingerprints, ID generation, duplicate policy, revisions, and audit.
 *
 * Issuance is fail-closed: the link exists only if the registry transaction
 * commits. No IDs are minted client-side and no URL is handed out without a
 * committed record (drafts excepted, and drafts are explicit).
 */
import { and, eq, ne, sql } from "drizzle-orm";
import {
  exactFingerprint,
  nearFingerprint,
  singleFieldDifference,
  type FingerprintInput,
} from "@/core/fingerprint";
import { newId } from "@/core/ids";
import {
  assembleUrl,
  canonicalUtmValue,
  normalizeDestination,
  type UtmParams,
} from "@/core/url";
import {
  lengthWarning,
  validateLink,
  type ValidationFinding,
  type ValidationResult,
} from "@/core/validation";
import type { Db, Tx } from "@/db/client";
import {
  campaigns,
  duplicateResolutions,
  linkRevisions,
  links,
  platformPresets,
  validationRuns,
} from "@/db/schema";
import { prefixedUlid } from "@/core/ids";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";
import { getConfig } from "./config";
import { enqueueOutboxEvent } from "./outbox";
import { getTaxonomyView } from "./taxonomy";
import { getDestinationPolicies } from "./destinations";

export interface LinkRequest {
  destination: string;
  campaignId: string;
  presetKey?: string;
  utmSource: string;
  utmMedium: string;
  utmContent?: string | null;
  utmTerm?: string | null;
  status?: "draft" | "issued";
  /** Exact-duplicate handling: absent = block; "override" needs role + reason. */
  duplicateAction?: "override" | null;
  duplicateReason?: string | null;
  batchId?: string | null;
  correlationId?: string | null;
}

export interface DuplicateInfo {
  exact: { linkId: string; finalUrl: string } | null;
  near: { linkId: string; finalUrl: string; kind: string }[];
}

export interface LinkPreview {
  ok: boolean;
  validation: ValidationResult;
  duplicates: DuplicateInfo;
  normalizedDestination: string | null;
  finalUrlPreview: string | null; // uses placeholder IDs, real IDs are minted at issuance
  utm: {
    utm_id: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content: string | null;
    utm_term: string | null;
  } | null;
}

export class DuplicateError extends Error {
  constructor(public existingLinkId: string, public existingUrl: string) {
    super(
      `An identical governed link already exists (${existingLinkId}). Reuse it, or override with a reason if you are authorized.`,
    );
    this.name = "DuplicateError";
  }
}

export class IssueError extends Error {
  constructor(public findings: ValidationFinding[]) {
    super(`Link cannot be issued: ${findings.filter((f) => f.severity === "error").map((f) => f.message).join(" ")}`);
    this.name = "IssueError";
  }
}

interface PreparedLink {
  campaign: typeof campaigns.$inferSelect;
  presetKey: string;
  normalizedDestination: string;
  canonical: {
    source: string;
    medium: string;
    campaign: string;
    content: string | null;
    term: string | null;
  };
  fingerprint: string;
  nearFp: string;
  validation: ValidationResult;
  fingerprintInput: FingerprintInput;
}

async function prepare(db: Db | Tx, input: LinkRequest): Promise<PreparedLink> {
  const presetKey = input.presetKey?.trim() || "generic";
  const [campaign] = input.campaignId
    ? await db.select().from(campaigns).where(eq(campaigns.id, input.campaignId))
    : [];

  const presetRows = await db
    .select()
    .from(platformPresets)
    .where(eq(platformPresets.key, presetKey));
  const preset = presetRows[0] ?? null;

  const taxonomy = await getTaxonomyView(db as Db);
  const destinationPolicies = await getDestinationPolicies(db as Db);
  const config = await getConfig(db);

  // Preset defaults fill blanks; explicit values win.
  const utmSourceRaw = input.utmSource?.trim() || (preset?.defaults as Record<string, string>)?.utm_source || "";
  const utmMediumRaw = input.utmMedium?.trim() || (preset?.defaults as Record<string, string>)?.utm_medium || "";

  const validation = validateLink(
    {
      destination: input.destination,
      utmSource: utmSourceRaw,
      utmMedium: utmMediumRaw,
      utmCampaign: campaign?.utmCampaign ?? "",
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
      campaignId: campaign?.id ?? null,
      presetKey,
    },
    {
      destinationPolicies,
      taxonomy,
      preset: preset
        ? {
            key: preset.key,
            verificationState: preset.verificationState,
            supportedMacros: (preset.supportedMacros as string[]) ?? [],
            requiredFields: (preset.requiredFields as string[]) ?? [],
          }
        : null,
      requiredFields: [
        ...config.requiredFields,
        ...(((preset?.requiredFields as string[]) ?? []).filter(Boolean)),
      ],
      recommendedMaxLength: config.recommendedMaxUrlLength,
    },
  );

  let normalized = "";
  try {
    normalized = normalizeDestination(input.destination).url;
  } catch {
    // validation already carries the destination error
  }

  // Resolve source aliases to canonical slugs.
  const aliasOwner = taxonomy.sources.find((s) =>
    s.aliases.includes(utmSourceRaw.trim().toLowerCase()),
  );
  const canonicalSourceSlug = aliasOwner ? aliasOwner.slug : canonicalUtmValue(utmSourceRaw);

  const canonical = {
    source: canonicalSourceSlug,
    medium: canonicalUtmValue(utmMediumRaw),
    campaign: campaign ? campaign.utmCampaign : "",
    content: input.utmContent?.trim() ? canonicalUtmValue(input.utmContent) : null,
    term: input.utmTerm?.trim() ? canonicalUtmValue(input.utmTerm) : null,
  };

  const fingerprintInput: FingerprintInput = {
    normalizedDestination: normalized || "https://invalid.invalid/",
    initiativeId: campaign?.initiativeId ?? null,
    campaignId: campaign?.id ?? "",
    utmSource: canonical.source,
    utmMedium: canonical.medium,
    utmCampaign: canonical.campaign,
    utmContent: canonical.content,
    utmTerm: canonical.term,
    platformPresetKey: presetKey,
    staticParams: (preset?.staticParams as Record<string, string>) ?? {},
  };

  return {
    campaign: campaign as typeof campaigns.$inferSelect,
    presetKey,
    normalizedDestination: normalized,
    canonical,
    fingerprint: exactFingerprint(fingerprintInput),
    nearFp: nearFingerprint(fingerprintInput),
    validation,
    fingerprintInput,
  };
}

async function findDuplicates(db: Db | Tx, prepared: PreparedLink): Promise<DuplicateInfo> {
  const exactRows = await db
    .select({ id: links.id, finalUrl: links.finalUrl })
    .from(links)
    .where(and(eq(links.fingerprint, prepared.fingerprint), ne(links.status, "retired")))
    .limit(1);
  const nearRows = await db
    .select()
    .from(links)
    .where(
      and(
        eq(links.nearFingerprint, prepared.nearFp),
        ne(links.status, "retired"),
        sql`${links.fingerprint} <> ${prepared.fingerprint}`,
      ),
    )
    .limit(5);

  // One-field-difference near duplicates within the same campaign.
  const sameCampaign = prepared.campaign
    ? await db
        .select()
        .from(links)
        .where(and(eq(links.campaignId, prepared.campaign.id), ne(links.status, "retired")))
        .limit(200)
    : [];
  const oneField = sameCampaign
    .filter((l) => l.fingerprint !== prepared.fingerprint && l.nearFingerprint !== prepared.nearFp)
    .map((l) => ({
      link: l,
      field: singleFieldDifference(prepared.fingerprintInput, {
        normalizedDestination: l.destinationNormalized,
        initiativeId: l.initiativeId,
        campaignId: l.campaignId,
        utmSource: l.utmSource,
        utmMedium: l.utmMedium,
        utmCampaign: l.utmCampaign,
        utmContent: l.utmContent,
        utmTerm: l.utmTerm,
        platformPresetKey: l.platformPresetKey,
      }),
    }))
    .filter((x) => x.field !== null)
    .slice(0, 5);

  return {
    exact: exactRows[0] ? { linkId: exactRows[0].id, finalUrl: exactRows[0].finalUrl } : null,
    near: [
      ...nearRows.map((l) => ({
        linkId: l.id,
        finalUrl: l.finalUrl,
        kind: "canonicalization-variant",
      })),
      ...oneField.map((x) => ({
        linkId: x.link.id,
        finalUrl: x.link.finalUrl,
        kind: `one-field-difference:${x.field}`,
      })),
    ],
  };
}

/** Dry-run: validation + duplicate check + URL preview. Never writes. */
export async function previewLink(db: Db, input: LinkRequest): Promise<LinkPreview> {
  const prepared = await prepare(db, input);
  const config = await getConfig(db);
  const duplicates = await findDuplicates(db, prepared);

  let finalUrlPreview: string | null = null;
  let utm: LinkPreview["utm"] = null;
  if (prepared.normalizedDestination && prepared.campaign) {
    const params: UtmParams = {
      utm_id: prepared.campaign.id,
      utm_source: prepared.canonical.source,
      utm_medium: prepared.canonical.medium,
      utm_campaign: prepared.canonical.campaign,
      utm_content: prepared.canonical.content,
      utm_term: prepared.canonical.term,
      rp_initiative_id:
        config.publicParamPolicy.rp_initiative_id && prepared.campaign.initiativeId
          ? prepared.campaign.initiativeId
          : null,
      rp_link_id: config.publicParamPolicy.rp_link_id ? "rpl_PREVIEW" : null,
    };
    finalUrlPreview = assembleUrl(prepared.normalizedDestination, params);
    utm = {
      utm_id: prepared.campaign.id,
      utm_source: prepared.canonical.source,
      utm_medium: prepared.canonical.medium,
      utm_campaign: prepared.canonical.campaign,
      utm_content: prepared.canonical.content,
      utm_term: prepared.canonical.term,
    };
    const lw = lengthWarning(finalUrlPreview, config.recommendedMaxUrlLength);
    if (lw) prepared.validation.findings.push(lw);
  }
  if (duplicates.exact) {
    prepared.validation.findings.push({
      code: "exact_duplicate",
      severity: "error",
      field: null,
      message: `Identical governed link already exists (${duplicates.exact.linkId}). Reuse it or request an authorized override.`,
    });
  }
  for (const near of duplicates.near) {
    prepared.validation.findings.push({
      code: "near_duplicate",
      severity: "warning",
      field: null,
      message: `Near-duplicate of ${near.linkId} (${near.kind}).`,
    });
  }

  return {
    ok: !prepared.validation.findings.some((f) => f.severity === "error"),
    validation: prepared.validation,
    duplicates,
    normalizedDestination: prepared.normalizedDestination || null,
    finalUrlPreview,
    utm,
  };
}

export interface IssuedLink {
  link: typeof links.$inferSelect;
  validation: ValidationResult;
  duplicates: DuplicateInfo;
}

/**
 * Issue (or save as draft) one governed link. Transactional and fail-closed.
 */
export async function issueLink(
  db: Db,
  actor: SessionUser,
  input: LinkRequest,
): Promise<IssuedLink> {
  const config = await getConfig(db);

  return db.transaction(async (tx) => {
    const prepared = await prepare(tx, input);
    if (!prepared.validation.ok) {
      throw new IssueError(prepared.validation.findings);
    }
    const duplicates = await findDuplicates(tx, prepared);

    let override = false;
    if (duplicates.exact) {
      const allowed = config.duplicateOverrideRoles.includes(actor.role);
      if (input.duplicateAction !== "override") {
        throw new DuplicateError(duplicates.exact.linkId, duplicates.exact.finalUrl);
      }
      if (!allowed) {
        throw new DuplicateError(duplicates.exact.linkId, duplicates.exact.finalUrl);
      }
      if (!input.duplicateReason?.trim()) {
        throw new Error("A reason is required to override an exact duplicate.");
      }
      override = true;
    }

    const linkId = newId("link");
    const status = input.status === "draft" ? "draft" : "issued";
    const params: UtmParams = {
      utm_id: prepared.campaign.id,
      utm_source: prepared.canonical.source,
      utm_medium: prepared.canonical.medium,
      utm_campaign: prepared.canonical.campaign,
      utm_content: prepared.canonical.content,
      utm_term: prepared.canonical.term,
      rp_initiative_id:
        config.publicParamPolicy.rp_initiative_id && prepared.campaign.initiativeId
          ? prepared.campaign.initiativeId
          : null,
      rp_link_id: config.publicParamPolicy.rp_link_id ? linkId : null,
    };
    const finalUrl = assembleUrl(prepared.normalizedDestination, params);

    const warningsOnly = prepared.validation.findings.some((f) => f.severity === "warning");
    const [row] = await tx
      .insert(links)
      .values({
        id: linkId,
        campaignId: prepared.campaign.id,
        initiativeId: prepared.campaign.initiativeId,
        batchId: input.batchId ?? null,
        destinationRaw: input.destination,
        destinationNormalized: prepared.normalizedDestination,
        finalUrl,
        utmId: prepared.campaign.id,
        utmSource: prepared.canonical.source,
        utmMedium: prepared.canonical.medium,
        utmCampaign: prepared.canonical.campaign,
        utmContent: prepared.canonical.content,
        utmTerm: prepared.canonical.term,
        rpInitiativeIdParam: params.rp_initiative_id ?? null,
        rpLinkIdParam: params.rp_link_id ?? null,
        platformPresetKey: prepared.presetKey,
        fingerprint: prepared.fingerprint,
        nearFingerprint: prepared.nearFp,
        duplicateOverride: override,
        status,
        configVersion: config.configVersion,
        validationState: warningsOnly ? "warnings" : "passed_syntactic",
        createdBy: actor.id,
        issuedAt: status === "issued" ? new Date() : null,
      })
      .returning();

    await tx.insert(validationRuns).values({
      id: newId("validation"),
      linkId,
      kind: "syntactic",
      passed: true,
      findings: prepared.validation.findings,
    });

    if (override && duplicates.exact) {
      await tx.insert(duplicateResolutions).values({
        id: prefixedUlid("dup"),
        linkId,
        existingLinkId: duplicates.exact.linkId,
        action: "override",
        reason: input.duplicateReason,
        actorId: actor.id,
      });
      await recordAudit(tx, actor, {
        action: "link.duplicate_override",
        entityType: "link",
        entityId: linkId,
        reason: input.duplicateReason,
        context: { existingLinkId: duplicates.exact.linkId },
        configVersion: config.configVersion,
        correlationId: input.correlationId,
      });
    }

    await enqueueOutboxEvent(tx, {
      type: "warehouse.snapshot.link",
      payload: { linkId },
      idempotencyKey: `warehouse.snapshot.link:${linkId}:0`,
    });

    await recordAudit(tx, actor, {
      action: status === "issued" ? "link.issued" : "link.draft_created",
      entityType: "link",
      entityId: linkId,
      after: row,
      configVersion: config.configVersion,
      correlationId: input.correlationId,
      context: input.batchId ? { batchId: input.batchId } : null,
    });

    return { link: row, validation: prepared.validation, duplicates };
  });
}

/** Record an explicit "reuse existing link" decision (audited, no new link). */
export async function recordReuse(
  db: Db,
  actor: SessionUser,
  existingLinkId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(duplicateResolutions).values({
      id: prefixedUlid("dup"),
      linkId: null,
      existingLinkId,
      action: "reuse",
      actorId: actor.id,
    });
    await recordAudit(tx, actor, {
      action: "link.duplicate_reused",
      entityType: "link",
      entityId: existingLinkId,
    });
  });
}

/**
 * Material change to an issued link → immutable revision + regenerated URL.
 * Draft links are edited in place (still audited).
 */
export async function reviseLink(
  db: Db,
  actor: SessionUser,
  linkId: string,
  patch: Partial<Pick<LinkRequest, "destination" | "utmSource" | "utmMedium" | "utmContent" | "utmTerm" | "presetKey">>,
  reason: string,
): Promise<IssuedLink> {
  if (!reason?.trim()) throw new Error("A reason is required to revise a link.");
  const config = await getConfig(db);
  return db.transaction(async (tx) => {
    const existingRows = await tx.select().from(links).where(eq(links.id, linkId));
    const existing = existingRows[0];
    if (!existing) throw new Error("Link not found.");
    if (existing.status === "retired") throw new Error("Retired links cannot be revised.");

    const request: LinkRequest = {
      destination: patch.destination ?? existing.destinationRaw,
      campaignId: existing.campaignId,
      presetKey: patch.presetKey ?? existing.platformPresetKey,
      utmSource: patch.utmSource ?? existing.utmSource,
      utmMedium: patch.utmMedium ?? existing.utmMedium,
      utmContent: patch.utmContent !== undefined ? patch.utmContent : existing.utmContent,
      utmTerm: patch.utmTerm !== undefined ? patch.utmTerm : existing.utmTerm,
    };
    const prepared = await prepare(tx, request);
    if (!prepared.validation.ok) throw new IssueError(prepared.validation.findings);

    const params: UtmParams = {
      utm_id: existing.campaignId,
      utm_source: prepared.canonical.source,
      utm_medium: prepared.canonical.medium,
      utm_campaign: prepared.canonical.campaign,
      utm_content: prepared.canonical.content,
      utm_term: prepared.canonical.term,
      rp_initiative_id: existing.rpInitiativeIdParam,
      rp_link_id: existing.rpLinkIdParam, // link ID is immutable across revisions
    };
    const finalUrl = assembleUrl(prepared.normalizedDestination, params);

    const isIssued = existing.status === "issued";
    const nextRevision = isIssued ? existing.currentRevision + 1 : existing.currentRevision;

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const fields: [string, unknown, unknown][] = [
      ["destinationNormalized", existing.destinationNormalized, prepared.normalizedDestination],
      ["utmSource", existing.utmSource, prepared.canonical.source],
      ["utmMedium", existing.utmMedium, prepared.canonical.medium],
      ["utmContent", existing.utmContent, prepared.canonical.content],
      ["utmTerm", existing.utmTerm, prepared.canonical.term],
      ["platformPresetKey", existing.platformPresetKey, prepared.presetKey],
      ["finalUrl", existing.finalUrl, finalUrl],
    ];
    for (const [field, before, after] of fields) {
      if (before !== after) diff[field] = { before, after };
    }

    if (isIssued) {
      await tx.insert(linkRevisions).values({
        id: newId("revision"),
        linkId,
        revisionNumber: existing.currentRevision,
        snapshot: existing,
        diff,
        reason,
        actorId: actor.id,
      });
    }

    const [row] = await tx
      .update(links)
      .set({
        destinationRaw: request.destination,
        destinationNormalized: prepared.normalizedDestination,
        finalUrl,
        utmSource: prepared.canonical.source,
        utmMedium: prepared.canonical.medium,
        utmContent: prepared.canonical.content,
        utmTerm: prepared.canonical.term,
        platformPresetKey: prepared.presetKey,
        fingerprint: prepared.fingerprint,
        nearFingerprint: prepared.nearFp,
        currentRevision: nextRevision,
        configVersion: existing.configVersion, // issuance-time config version is retained
        updatedAt: new Date(),
      })
      .where(eq(links.id, linkId))
      .returning();

    await tx.insert(validationRuns).values({
      id: newId("validation"),
      linkId,
      kind: "syntactic",
      passed: true,
      findings: prepared.validation.findings,
    });
    await enqueueOutboxEvent(tx, {
      type: "warehouse.snapshot.link",
      payload: { linkId },
      idempotencyKey: `warehouse.snapshot.link:${linkId}:${nextRevision}`,
    });
    await recordAudit(tx, actor, {
      action: isIssued ? "link.revised" : "link.draft_updated",
      entityType: "link",
      entityId: linkId,
      before: existing,
      after: row,
      reason,
      configVersion: config.configVersion,
    });

    return { link: row, validation: prepared.validation, duplicates: { exact: null, near: [] } };
  });
}

export async function retireLink(db: Db, actor: SessionUser, linkId: string, reason: string) {
  if (!reason?.trim()) throw new Error("A reason is required to retire a link.");
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(links).where(eq(links.id, linkId));
    const existing = rows[0];
    if (!existing) throw new Error("Link not found.");
    const [row] = await tx
      .update(links)
      .set({ status: "retired", updatedAt: new Date() })
      .where(eq(links.id, linkId))
      .returning();
    await recordAudit(tx, actor, {
      action: "link.retired",
      entityType: "link",
      entityId: linkId,
      before: existing,
      after: row,
      reason,
    });
    return row;
  });
}
