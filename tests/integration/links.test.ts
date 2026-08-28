import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, duplicateResolutions, linkRevisions, links, validationRuns } from "@/db/schema";
import type { SessionUser } from "@/services/auth";
import { createCampaign } from "@/services/campaigns";
import { createInitiative } from "@/services/initiatives";
import { DuplicateError, issueLink, previewLink, recordReuse, reviseLink, retireLink } from "@/services/links";
import { updateSetting } from "@/services/config";
import { adminActor, freshDb, userActor } from "../helpers";

let db: Db;
let admin: SessionUser;
let user: SessionUser;

beforeEach(async () => {
  db = await freshDb();
  admin = await adminActor(db);
  user = await userActor(db);
});

async function makeCampaign(name = "Q3 Product Launch", initiativeId: string | null = null) {
  return createCampaign(db, admin, { name, initiativeId });
}

const baseRequest = (campaignId: string) => ({
  destination: "runpod.io/product?ref=abc#pricing",
  campaignId,
  presetKey: "generic",
  utmSource: "linkedin-paid",
  utmMedium: "paid",
  utmContent: "founder-video",
});

describe("campaign and initiative identity", () => {
  it("mints immutable rpc_/rpi_ IDs and never derives identity from names", async () => {
    const initiative = await createInitiative(db, admin, { name: "2026 Launch" });
    expect(initiative.id).toMatch(/^rpi_/);
    const campaign = await makeCampaign("Q3 Product Launch", initiative.id);
    expect(campaign.id).toMatch(/^rpc_/);
    expect(campaign.utmCampaign).toBe("q3-product-launch");

    // Renaming the campaign never changes the canonical ID or utm slug.
    const { updateCampaign } = await import("@/services/campaigns");
    const renamed = await updateCampaign(db, admin, campaign.id, { name: "Q3 Launch (renamed)" }, "rename");
    expect(renamed.id).toBe(campaign.id);
    expect(renamed.utmCampaign).toBe(campaign.utmCampaign);
  });

  it("refuses to issue against a nonexistent campaign (no implicit creation)", async () => {
    await expect(
      issueLink(db, user, { ...baseRequest("rpc_01ARZ3NDEKTSV4RRFFQ69G5FAV") }),
    ).rejects.toThrow(/campaign/i);
  });
});

describe("issueLink", () => {
  it("issues a link carrying utm_id = campaign ID and preserves foreign params", async () => {
    const campaign = await makeCampaign();
    const { link } = await issueLink(db, user, baseRequest(campaign.id));

    expect(link.id).toMatch(/^rpl_/);
    expect(link.utmId).toBe(campaign.id);
    const url = new URL(link.finalUrl);
    expect(url.searchParams.get("utm_id")).toBe(campaign.id);
    expect(url.searchParams.get("utm_campaign")).toBe("q3-product-launch");
    expect(url.searchParams.get("ref")).toBe("abc");
    expect(url.hash).toBe("#pricing");
    // Default policy: rp_link_id on, rp_initiative_id off.
    expect(url.searchParams.get("rp_link_id")).toBe(link.id);
    expect(url.searchParams.get("rp_initiative_id")).toBeNull();
    // Param order per contract.
    expect([...url.searchParams.keys()]).toEqual([
      "ref",
      "utm_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "rp_link_id",
    ]);
  });

  it("retains raw identifier values on the record for reporting repair", async () => {
    const campaign = await makeCampaign();
    const { link } = await issueLink(db, user, baseRequest(campaign.id));
    expect(link.utmSource).toBe("linkedin-paid");
    expect(link.utmMedium).toBe("paid");
    expect(link.utmContent).toBe("founder-video");
    expect(link.rpLinkIdParam).toBe(link.id);
    expect(link.configVersion).toBeGreaterThanOrEqual(1);
  });

  it("emits rp_initiative_id only when policy enables it, but always stores the mapping", async () => {
    const initiative = await createInitiative(db, admin, { name: "Big Launch" });
    const campaign = await makeCampaign("C1", initiative.id);

    const { link: withoutParam } = await issueLink(db, user, baseRequest(campaign.id));
    expect(new URL(withoutParam.finalUrl).searchParams.get("rp_initiative_id")).toBeNull();
    expect(withoutParam.initiativeId).toBe(initiative.id); // mapping preserved regardless

    await updateSetting(db, admin, "public_param_policy", { rp_link_id: true, rp_initiative_id: true }, "enable");
    const { link: withParam } = await issueLink(db, user, {
      ...baseRequest(campaign.id),
      utmContent: "variant-2",
    });
    expect(new URL(withParam.finalUrl).searchParams.get("rp_initiative_id")).toBe(initiative.id);
  });

  it("records a syntactic validation run and an audit event", async () => {
    const campaign = await makeCampaign();
    const { link } = await issueLink(db, user, baseRequest(campaign.id));
    const runs = await db.select().from(validationRuns).where(eq(validationRuns.linkId, link.id));
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("syntactic");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, link.id));
    expect(events.some((e) => e.action === "link.issued")).toBe(true);
  });

  it("fails closed on validation errors — nothing is written", async () => {
    const campaign = await makeCampaign();
    await expect(
      issueLink(db, user, { ...baseRequest(campaign.id), destination: "not-approved.com/x" }),
    ).rejects.toThrow();
    expect(await db.select().from(links)).toHaveLength(0);
  });
});

describe("duplicate protection", () => {
  it("blocks exact duplicates and recommends the existing record", async () => {
    const campaign = await makeCampaign();
    const { link } = await issueLink(db, user, baseRequest(campaign.id));
    await expect(issueLink(db, user, baseRequest(campaign.id))).rejects.toThrow(DuplicateError);
    // Reordered destination query and different casing are still exact duplicates.
    await expect(
      issueLink(db, user, {
        ...baseRequest(campaign.id),
        destination: "runpod.io/product?ref=abc#pricing",
        utmContent: "Founder Video",
      }),
    ).rejects.toThrow(DuplicateError);
    expect(await db.select().from(links)).toHaveLength(1);

    const preview = await previewLink(db, baseRequest(campaign.id));
    expect(preview.duplicates.exact?.linkId).toBe(link.id);
    expect(preview.ok).toBe(false);
  });

  it("allows an authorized override with a reason, audited", async () => {
    const campaign = await makeCampaign();
    await issueLink(db, user, baseRequest(campaign.id));

    // Plain user cannot override even with a reason.
    await expect(
      issueLink(db, user, { ...baseRequest(campaign.id), duplicateAction: "override", duplicateReason: "why" }),
    ).rejects.toThrow(DuplicateError);
    // Admin without a reason is refused.
    await expect(
      issueLink(db, admin, { ...baseRequest(campaign.id), duplicateAction: "override" }),
    ).rejects.toThrow(/reason/i);

    const { link } = await issueLink(db, admin, {
      ...baseRequest(campaign.id),
      duplicateAction: "override",
      duplicateReason: "Separate placement requires distinct record",
    });
    expect(link.duplicateOverride).toBe(true);
    const resolutions = await db.select().from(duplicateResolutions);
    expect(resolutions.some((r) => r.action === "override" && r.linkId === link.id)).toBe(true);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, link.id));
    expect(events.some((e) => e.action === "link.duplicate_override")).toBe(true);
  });

  it("records explicit reuse decisions", async () => {
    const campaign = await makeCampaign();
    const { link } = await issueLink(db, user, baseRequest(campaign.id));
    await recordReuse(db, user, link.id);
    const resolutions = await db.select().from(duplicateResolutions);
    expect(resolutions.some((r) => r.action === "reuse" && r.existingLinkId === link.id)).toBe(true);
  });

  it("warns on near duplicates (one-field difference) without blocking", async () => {
    const campaign = await makeCampaign();
    await issueLink(db, user, baseRequest(campaign.id));
    const preview = await previewLink(db, { ...baseRequest(campaign.id), utmContent: "static-banner" });
    expect(preview.ok).toBe(true);
    expect(preview.validation.findings.some((f) => f.code === "near_duplicate")).toBe(true);
  });
});

describe("revisions", () => {
  it("edits drafts in place, but creates immutable revisions for issued links", async () => {
    const campaign = await makeCampaign();
    const { link: draft } = await issueLink(db, user, { ...baseRequest(campaign.id), status: "draft" });
    expect(draft.status).toBe("draft");
    const { link: editedDraft } = await reviseLink(db, user, draft.id, { utmContent: "v2" }, "draft edit");
    expect(editedDraft.currentRevision).toBe(0);
    expect(await db.select().from(linkRevisions)).toHaveLength(0);

    const { link: issued } = await issueLink(db, user, { ...baseRequest(campaign.id), utmContent: "issued-1" });
    const { link: revised } = await reviseLink(db, user, issued.id, { utmContent: "issued-2" }, "creative swap");
    expect(revised.id).toBe(issued.id); // link ID immutable
    expect(revised.currentRevision).toBe(1);
    expect(revised.utmContent).toBe("issued-2");
    expect(new URL(revised.finalUrl).searchParams.get("rp_link_id")).toBe(issued.id);

    const revisions = await db.select().from(linkRevisions).where(eq(linkRevisions.linkId, issued.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].id).toMatch(/^rpr_/);
    const diff = revisions[0].diff as Record<string, { before: unknown; after: unknown }>;
    expect(diff.utmContent).toEqual({ before: "issued-1", after: "issued-2" });
    expect(revisions[0].reason).toBe("creative swap");
  });

  it("requires a reason and refuses to revise retired links", async () => {
    const campaign = await makeCampaign();
    const { link } = await issueLink(db, user, baseRequest(campaign.id));
    await expect(reviseLink(db, user, link.id, { utmContent: "x" }, "")).rejects.toThrow(/reason/i);
    await retireLink(db, admin, link.id, "campaign ended");
    await expect(reviseLink(db, user, link.id, { utmContent: "x" }, "why")).rejects.toThrow(/retired/i);
  });
});
