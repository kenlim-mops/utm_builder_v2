/**
 * Governed taxonomy (mediums, sources, aliases) — versioned and audited.
 */
import { asc, eq, sql } from "drizzle-orm";
import { prefixedUlid } from "@/core/ids";
import type { TaxonomyView } from "@/core/validation";
import type { Db } from "@/db/client";
import { taxonomyMediums, taxonomySources } from "@/db/schema";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";
import { bumpConfigVersion } from "./config";

export async function getTaxonomyView(db: Db): Promise<TaxonomyView> {
  const mediums = await db
    .select()
    .from(taxonomyMediums)
    .orderBy(asc(taxonomyMediums.sortOrder));
  const sources = await db
    .select()
    .from(taxonomySources)
    .orderBy(asc(taxonomySources.sortOrder));
  return {
    mediums: mediums.map((m) => ({ slug: m.slug, status: m.status })),
    sources: sources.map((s) => ({
      slug: s.slug,
      mediumSlug: s.mediumSlug,
      status: s.status,
      aliases: (s.aliases as string[]) ?? [],
    })),
  };
}

export async function listTaxonomy(db: Db) {
  const mediums = await db.select().from(taxonomyMediums).orderBy(asc(taxonomyMediums.sortOrder));
  const sources = await db.select().from(taxonomySources).orderBy(asc(taxonomySources.sortOrder));
  return { mediums, sources };
}

/** Resolve an alias to its canonical source slug (or return the input). */
export async function canonicalSource(db: Db, value: string): Promise<string> {
  const v = value.trim().toLowerCase();
  const sources = await db.select().from(taxonomySources);
  const direct = sources.find((s) => s.slug === v);
  if (direct) return direct.slug;
  const aliased = sources.find((s) => ((s.aliases as string[]) ?? []).includes(v));
  return aliased ? aliased.slug : v;
}

export interface SourceInput {
  slug: string;
  mediumSlug: string;
  label?: string;
  description?: string | null;
  aliases?: string[];
  status?: "active" | "deprecated" | "disabled";
  severity?: "info" | "warning" | "error";
  sortOrder?: number;
}

export async function upsertSource(
  db: Db,
  actor: SessionUser,
  input: SourceInput,
  reason: string | null,
) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(taxonomySources)
      .where(eq(taxonomySources.slug, input.slug));
    const before = existing[0] ?? null;
    let row;
    if (before) {
      [row] = await tx
        .update(taxonomySources)
        .set({
          mediumSlug: input.mediumSlug,
          label: input.label ?? before.label,
          description: input.description ?? before.description,
          aliases: input.aliases ?? before.aliases,
          status: input.status ?? before.status,
          severity: input.severity ?? before.severity,
          sortOrder: input.sortOrder ?? before.sortOrder,
          version: sql`${taxonomySources.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(taxonomySources.slug, input.slug))
        .returning();
    } else {
      [row] = await tx
        .insert(taxonomySources)
        .values({
          id: prefixedUlid("src"),
          slug: input.slug,
          mediumSlug: input.mediumSlug,
          label: input.label ?? input.slug,
          description: input.description ?? null,
          aliases: input.aliases ?? [],
          status: input.status ?? "active",
          severity: input.severity ?? "error",
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
    }
    const configVersion = await bumpConfigVersion(tx);
    await recordAudit(tx, actor, {
      action: before ? "taxonomy.source.updated" : "taxonomy.source.created",
      entityType: "taxonomy_source",
      entityId: row.id,
      before,
      after: row,
      reason,
      configVersion,
    });
    return row;
  });
}

export async function upsertMedium(
  db: Db,
  actor: SessionUser,
  input: {
    slug: string;
    label?: string;
    description?: string | null;
    status?: "active" | "deprecated" | "disabled";
    sortOrder?: number;
  },
  reason: string | null,
) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(taxonomyMediums)
      .where(eq(taxonomyMediums.slug, input.slug));
    const before = existing[0] ?? null;
    let row;
    if (before) {
      [row] = await tx
        .update(taxonomyMediums)
        .set({
          label: input.label ?? before.label,
          description: input.description ?? before.description,
          status: input.status ?? before.status,
          sortOrder: input.sortOrder ?? before.sortOrder,
          version: sql`${taxonomyMediums.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(taxonomyMediums.slug, input.slug))
        .returning();
    } else {
      [row] = await tx
        .insert(taxonomyMediums)
        .values({
          id: prefixedUlid("med"),
          slug: input.slug,
          label: input.label ?? input.slug,
          description: input.description ?? null,
          status: input.status ?? "active",
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
    }
    const configVersion = await bumpConfigVersion(tx);
    await recordAudit(tx, actor, {
      action: before ? "taxonomy.medium.updated" : "taxonomy.medium.created",
      entityType: "taxonomy_medium",
      entityId: row.id,
      before,
      after: row,
      reason,
      configVersion,
    });
    return row;
  });
}
