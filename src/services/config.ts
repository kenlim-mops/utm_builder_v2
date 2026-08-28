/**
 * Versioned application configuration. Every admin change bumps the global
 * config version; issued links record the version in force at issuance.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { appSettings, configVersions } from "@/db/schema";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";

export interface PublicParamPolicy {
  rp_link_id: boolean;
  rp_initiative_id: boolean;
}

export interface AppConfig {
  publicParamPolicy: PublicParamPolicy;
  bulkLimit: number;
  requiredFields: string[];
  duplicateOverrideRoles: string[];
  recommendedMaxUrlLength: number;
  featureFlags: Record<string, boolean>;
  configVersion: number;
}

export async function getConfig(db: Db | Tx): Promise<AppConfig> {
  const rows = await db.select().from(appSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const versionRows = await db.select().from(configVersions).where(eq(configVersions.id, 1));
  const policy = (map.get("public_param_policy") as PublicParamPolicy | undefined) ?? {
    rp_link_id: true,
    rp_initiative_id: false,
  };
  return {
    publicParamPolicy: policy,
    bulkLimit: (map.get("bulk_limit") as number | undefined) ?? 200,
    requiredFields: (map.get("required_fields") as string[] | undefined) ?? [],
    duplicateOverrideRoles: (map.get("duplicate_override_roles") as string[] | undefined) ?? [
      "admin",
    ],
    recommendedMaxUrlLength: (map.get("recommended_max_url_length") as number | undefined) ?? 900,
    featureFlags: (map.get("feature_flags") as Record<string, boolean> | undefined) ?? {},
    configVersion: versionRows[0]?.version ?? 1,
  };
}

/** Bump the global config version. Call inside the mutating transaction. */
export async function bumpConfigVersion(db: Db | Tx): Promise<number> {
  const rows = await db
    .update(configVersions)
    .set({ version: sql`${configVersions.version} + 1`, updatedAt: new Date() })
    .where(eq(configVersions.id, 1))
    .returning({ version: configVersions.version });
  return rows[0].version;
}

export async function updateSetting(
  db: Db,
  actor: SessionUser,
  key: string,
  value: unknown,
  reason: string | null,
): Promise<AppConfig> {
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(appSettings).where(eq(appSettings.key, key));
    const before = existing[0]?.value ?? null;
    if (existing.length === 0) {
      await tx.insert(appSettings).values({ key, value, version: 1, updatedBy: actor.id });
    } else {
      await tx
        .update(appSettings)
        .set({
          value,
          version: sql`${appSettings.version} + 1`,
          updatedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.key, key));
    }
    const configVersion = await bumpConfigVersion(tx);
    await recordAudit(tx, actor, {
      action: "setting.updated",
      entityType: "setting",
      entityId: key,
      before,
      after: value,
      reason,
      configVersion,
    });
  });
  return getConfig(db);
}
