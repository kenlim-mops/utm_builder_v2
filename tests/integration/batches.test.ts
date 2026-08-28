import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { links } from "@/db/schema";
import type { SessionUser } from "@/services/auth";
import { batchDetail, createBatch, type BatchRowInput } from "@/services/batches";
import { createCampaign } from "@/services/campaigns";
import { updateSetting } from "@/services/config";
import { adminActor, freshDb, userActor } from "../helpers";

let db: Db;
let admin: SessionUser;
let user: SessionUser;
let campaignId: string;

beforeEach(async () => {
  db = await freshDb();
  admin = await adminActor(db);
  user = await userActor(db);
  campaignId = (await createCampaign(db, admin, { name: "Bulk Campaign" })).id;
});

const row = (i: number): BatchRowInput => ({
  destination: `runpod.io/page-${i}`,
  campaignId,
  presetKey: "generic",
  utmSource: "linkedin-paid",
  utmMedium: "paid",
  utmContent: `variant-${i}`,
});

describe("bulk issuance", () => {
  it("processes a full 200-row batch through the shared service", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i));
    const result = await createBatch(db, user, rows, "csv");
    expect(result.batchId).toMatch(/^rpb_/);
    expect(result.succeeded).toBe(200);
    expect(result.failed).toBe(0);
    expect(new Set(result.rows.map((r) => r.linkId)).size).toBe(200);

    const issued = await db.select().from(links).where(eq(links.batchId, result.batchId));
    expect(issued).toHaveLength(200);
    for (const link of issued) {
      expect(link.utmId).toBe(campaignId);
      expect(link.id).toMatch(/^rpl_/);
    }
  }, 120000);

  it("rejects batches above the configured limit", async () => {
    await expect(
      createBatch(db, user, Array.from({ length: 201 }, (_, i) => row(i)), "grid"),
    ).rejects.toThrow(/limit/i);
    await updateSetting(db, admin, "bulk_limit", 2, "test");
    await expect(
      createBatch(db, user, [row(1), row(2), row(3)], "grid"),
    ).rejects.toThrow(/limit of 2/i);
  });

  it("isolates bad rows: row errors never erase sibling rows", async () => {
    const rows: BatchRowInput[] = [
      row(1),
      { ...row(2), destination: "not-approved.example.net/x" }, // domain error
      row(3),
      { ...row(3) }, // exact duplicate of row index 2
      { ...row(4), utmSource: "not-a-source" }, // taxonomy error
    ];
    const result = await createBatch(db, user, rows, "paste");
    expect(result.status).toBe("completed_with_errors");
    expect(result.rows[0].status).toBe("issued");
    expect(result.rows[1].status).toBe("error");
    expect(result.rows[1].errors[0].code).toBe("domain_not_approved");
    expect(result.rows[2].status).toBe("issued");
    expect(result.rows[3].status).toBe("skipped_duplicate");
    expect(result.rows[3].linkId).toBe(result.rows[2].linkId); // points at the existing record
    expect(result.rows[4].status).toBe("error");
    expect(result.succeeded).toBe(2);

    const detail = await batchDetail(db, result.batchId);
    expect(detail?.batch.status).toBe("completed_with_errors");
    expect(detail?.rows).toHaveLength(5);
  });

  it("keeps single-link and bulk output identical for identical input", async () => {
    const { issueLink } = await import("@/services/links");
    const single = await issueLink(db, user, { ...row(1), utmContent: "single" });
    const bulk = await createBatch(db, user, [{ ...row(2), utmContent: "bulk" }], "grid");
    const [bulkLink] = await db.select().from(links).where(eq(links.id, bulk.rows[0].linkId!));

    const canonicalize = (u: string) => {
      const url = new URL(u);
      return {
        keys: [...url.searchParams.keys()].filter((k) => k !== "rp_link_id" && k !== "utm_content"),
        utmId: url.searchParams.get("utm_id"),
      };
    };
    expect(canonicalize(bulkLink.finalUrl)).toEqual(canonicalize(single.link.finalUrl));
  });
});
