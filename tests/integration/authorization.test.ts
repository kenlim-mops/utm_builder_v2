/**
 * Security-review regression tests (2026-09-04):
 *  - investigators are read-only in every shared service (M1)
 *  - investigator-minted tokens cannot carry write scopes (M1)
 *  - revise/retire/update require creator, campaign owner, or admin (M2)
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { SessionUser } from "@/services/auth";
import { AuthError } from "@/services/auth";
import { createPersonalAccessToken } from "@/services/access-tokens";
import { createBatch } from "@/services/batches";
import { createCampaign, updateCampaign } from "@/services/campaigns";
import { createInitiative, updateInitiative } from "@/services/initiatives";
import { issueLink, recordReuse, retireLink, reviseLink } from "@/services/links";
import { adminActor, freshDb, investigatorActor, userActor } from "../helpers";

let db: Db;
let admin: SessionUser;
let user: SessionUser;
let investigator: SessionUser;

beforeEach(async () => {
  db = await freshDb();
  admin = await adminActor(db);
  user = await userActor(db);
  investigator = await investigatorActor(db);
});

const request = (campaignId: string, content = "founder-video") => ({
  destination: "runpod.io/product?ref=abc",
  campaignId,
  presetKey: "generic",
  utmSource: "linkedin-paid",
  utmMedium: "paid",
  utmContent: content,
});

describe("investigator read-only enforcement (service layer)", () => {
  it("blocks every mutating service for investigators", async () => {
    const campaign = await createCampaign(db, admin, { name: "Gate Test" });
    await expect(createCampaign(db, investigator, { name: "Nope" })).rejects.toThrow(AuthError);
    await expect(createInitiative(db, investigator, { name: "Nope" })).rejects.toThrow(AuthError);
    await expect(issueLink(db, investigator, request(campaign.id))).rejects.toThrow(AuthError);
    await expect(
      createBatch(db, investigator, [request(campaign.id)], "grid"),
    ).rejects.toThrow(AuthError);
    const issued = await issueLink(db, admin, request(campaign.id));
    await expect(recordReuse(db, investigator, issued.link.id)).rejects.toThrow(AuthError);
    await expect(
      reviseLink(db, investigator, issued.link.id, { utmContent: "changed" }, "attempt"),
    ).rejects.toThrow(AuthError);
    await expect(retireLink(db, investigator, issued.link.id, "attempt")).rejects.toThrow(
      AuthError,
    );
    await expect(
      updateCampaign(db, investigator, campaign.id, { name: "Renamed" }, "attempt"),
    ).rejects.toThrow(AuthError);
  });

  it("restricts investigator-minted tokens to read-only scopes", async () => {
    const { metadata } = await createPersonalAccessToken(db, investigator, {});
    expect(metadata.scopes).toEqual(
      expect.arrayContaining(["utm:read", "utm:preview", "gtm:read"]),
    );
    expect(metadata.scopes).not.toContain("utm:issue");
    expect(metadata.scopes).not.toContain("utm:campaigns:write");
    await expect(
      createPersonalAccessToken(db, investigator, { scopes: ["utm:issue"] }),
    ).rejects.toThrow(/write scopes/);
    // Regular users can still mint write scopes.
    const userToken = await createPersonalAccessToken(db, user, {});
    expect(userToken.metadata.scopes).toContain("utm:issue");
  });
});

describe("ownership enforcement on mutations", () => {
  it("blocks a non-owner from revising or retiring someone else's link", async () => {
    const campaign = await createCampaign(db, admin, { name: "Ownership Test" });
    const issued = await issueLink(db, admin, request(campaign.id));
    await expect(
      reviseLink(db, user, issued.link.id, { utmContent: "hijack" }, "attempt"),
    ).rejects.toThrow(AuthError);
    await expect(retireLink(db, user, issued.link.id, "attempt")).rejects.toThrow(AuthError);
  });

  it("allows the creator, the campaign owner, and admins", async () => {
    // The admin creates the campaign and link, but explicitly assigns the
    // campaign to `user`, proving the owner path independently of creator.
    const campaign = await createCampaign(db, admin, { name: "Owned By User", ownerId: user.id });
    const issued = await issueLink(db, admin, request(campaign.id));
    // Campaign owner can revise a link created by somebody else.
    const revised = await reviseLink(
      db,
      user,
      issued.link.id,
      { utmContent: "creator-edit" },
      "owner edit",
    );
    expect(revised.link.utmContent).toBe("creator-edit");
    // Admin can retire.
    const retired = await retireLink(db, admin, issued.link.id, "admin retire");
    expect(retired.status).toBe("retired");
  });

  it("supports audited admin ownership transfer and rejects unauthorized owners", async () => {
    const campaign = await createCampaign(db, admin, { name: "Transfer Campaign" });
    const initiative = await createInitiative(db, admin, { name: "Transfer Initiative" });

    await expect(
      updateCampaign(db, admin, campaign.id, { ownerId: user.id }, null),
    ).rejects.toThrow(/reason/i);
    const transferredCampaign = await updateCampaign(
      db,
      admin,
      campaign.id,
      { ownerId: user.id },
      "Marketing ownership handoff",
    );
    expect(transferredCampaign.ownerId).toBe(user.id);

    const transferredInitiative = await updateInitiative(
      db,
      admin,
      initiative.id,
      { ownerId: user.id },
      "Program ownership handoff",
    );
    expect(transferredInitiative.ownerId).toBe(user.id);
    const actions = (await db.select({ action: auditEvents.action }).from(auditEvents)).map((row) => row.action);
    expect(actions).toContain("campaign.owner_transferred");
    expect(actions).toContain("initiative.owner_transferred");

    await expect(
      updateCampaign(db, user, campaign.id, { ownerId: admin.id }, "self transfer"),
    ).rejects.toThrow(AuthError);
    await expect(
      updateCampaign(db, admin, campaign.id, { ownerId: investigator.id }, "invalid owner"),
    ).rejects.toThrow(/read-only/i);
  });

  it("blocks non-owners from campaign/initiative metadata updates", async () => {
    const initiative = await createInitiative(db, admin, { name: "Admin Initiative" });
    const campaign = await createCampaign(db, admin, { name: "Admin Campaign" });
    await expect(
      updateCampaign(db, user, campaign.id, { name: "Taken over" }, "attempt"),
    ).rejects.toThrow(AuthError);
    await expect(
      updateInitiative(db, user, initiative.id, { name: "Taken over" }, "attempt"),
    ).rejects.toThrow(AuthError);
    // Admin still can.
    const renamed = await updateCampaign(db, admin, campaign.id, { name: "Renamed OK" }, "ok");
    expect(renamed.name).toBe("Renamed OK");
  });
});
