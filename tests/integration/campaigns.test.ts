import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { SessionUser } from "@/services/auth";
import { createCampaign } from "@/services/campaigns";
import { adminActor, freshDb, userActor } from "../helpers";

let db: Db;
let admin: SessionUser;
let user: SessionUser;

beforeEach(async () => {
  db = await freshDb();
  admin = await adminActor(db);
  user = await userActor(db);
});

describe("campaign duplicate governance", () => {
  it("blocks deterministic spacing and punctuation variants", async () => {
    const existing = await createCampaign(db, admin, { name: "Q4 Product Launch" });

    await expect(
      createCampaign(db, admin, {
        name: "Q4_Product.Launch",
        utmCampaign: "q4-product-launch-alt",
      }),
    ).rejects.toMatchObject({
      name: "CampaignDuplicateError",
      candidates: [expect.objectContaining({ id: existing.id })],
    });
  });

  it("requires an administrator and a reason for an override", async () => {
    await createCampaign(db, admin, { name: "Partner Launch" });
    const request = {
      name: "Partner_Launch",
      utmCampaign: "partner-launch-emea",
      duplicateAction: "override" as const,
    };

    await expect(createCampaign(db, user, { ...request, duplicateReason: "Separate region" }))
      .rejects.toThrow(/administrator/i);
    await expect(createCampaign(db, admin, request)).rejects.toThrow(/reason/i);
  });

  it("records an audited, justified override", async () => {
    const existing = await createCampaign(db, admin, { name: "AI Launch" });
    const created = await createCampaign(db, admin, {
      name: "AI_Launch",
      utmCampaign: "ai-launch-enterprise",
      duplicateAction: "override",
      duplicateReason: "Enterprise motion has a separate budget and reporting owner.",
    });

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "campaign.duplicate_override"));
    expect(event.entityId).toBe(created.id);
    expect(event.reason).toMatch(/separate budget/i);
    expect(event.context).toEqual({ candidateIds: [existing.id] });
  });
});
