/**
 * Platform preset administration — versioned adapter configurations.
 */
import { asc, eq, sql } from "drizzle-orm";
import { prefixedUlid } from "@/core/ids";
import type { Db } from "@/db/client";
import { platformPresets } from "@/db/schema";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";
import { bumpConfigVersion } from "./config";

export async function listPresets(db: Db) {
  return db.select().from(platformPresets).orderBy(asc(platformPresets.key));
}

export interface PresetInput {
  key: string;
  name?: string;
  outputType?: string;
  defaults?: Record<string, string>;
  supportedMacros?: string[];
  requiredFields?: string[];
  staticParams?: Record<string, string>;
  validationRules?: Record<string, unknown>;
  verificationState?: "draft" | "verified" | "deprecated";
  docsUrl?: string | null;
}

export async function upsertPreset(
  db: Db,
  actor: SessionUser,
  input: PresetInput,
  reason: string | null,
) {
  const key = input.key?.trim();
  if (!key) throw new Error("Preset key is required.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(platformPresets).where(eq(platformPresets.key, key));
    const before = existing[0] ?? null;
    let row;
    if (before) {
      [row] = await tx
        .update(platformPresets)
        .set({
          name: input.name ?? before.name,
          outputType: input.outputType ?? before.outputType,
          defaults: input.defaults ?? before.defaults,
          supportedMacros: input.supportedMacros ?? before.supportedMacros,
          requiredFields: input.requiredFields ?? before.requiredFields,
          staticParams: input.staticParams ?? before.staticParams,
          validationRules: input.validationRules ?? before.validationRules,
          verificationState: input.verificationState ?? before.verificationState,
          docsUrl: input.docsUrl !== undefined ? input.docsUrl : before.docsUrl,
          version: sql`${platformPresets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(platformPresets.key, key))
        .returning();
    } else {
      if (!input.name || !input.outputType) {
        throw new Error("New presets require a name and output type.");
      }
      [row] = await tx
        .insert(platformPresets)
        .values({
          id: prefixedUlid("pre"),
          key,
          name: input.name,
          outputType: input.outputType,
          defaults: input.defaults ?? {},
          supportedMacros: input.supportedMacros ?? [],
          requiredFields: input.requiredFields ?? [],
          staticParams: input.staticParams ?? {},
          validationRules: input.validationRules ?? {},
          verificationState: input.verificationState ?? "draft",
          docsUrl: input.docsUrl ?? null,
        })
        .returning();
    }
    const configVersion = await bumpConfigVersion(tx);
    await recordAudit(tx, actor, {
      action: before ? "preset.updated" : "preset.created",
      entityType: "platform_preset",
      entityId: row.id,
      before,
      after: row,
      reason,
      configVersion,
    });
    return row;
  });
}
