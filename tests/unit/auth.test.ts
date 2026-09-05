import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { capabilitiesFor, canManage, verifySsoPrincipal, type SessionUser } from "@/services/auth";

const actor = (role: SessionUser["role"], id = `usr_${role}`): SessionUser => ({
  id,
  email: `${role}@runpod.io`,
  name: role,
  role,
});

describe("authentication policy", () => {
  it("verifies a current signed SSO principal and rejects tampering or replay", () => {
    const timestamp = "1788581000";
    const email = "person@runpod.io";
    const secret = "test-sso-secret";
    const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}\n${email}`).digest("hex")}`;
    expect(verifySsoPrincipal({ email, timestamp, signature, secret, nowSeconds: 1788581000 })).toBe(email);
    expect(() => verifySsoPrincipal({ email: "attacker@runpod.io", timestamp, signature, secret, nowSeconds: 1788581000 })).toThrow(/signature/i);
    expect(() => verifySsoPrincipal({ email, timestamp, signature, secret, nowSeconds: 1788582000 })).toThrow(/expired/i);
  });

  it("reports role capabilities and record-specific management correctly", () => {
    const user = actor("user");
    const admin = actor("admin");
    const investigator = actor("investigator");
    expect(capabilitiesFor(user).canIssue).toBe(true);
    expect(capabilitiesFor(investigator).canIssue).toBe(false);
    expect(capabilitiesFor(investigator).canReadAudit).toBe(true);
    expect(capabilitiesFor(admin).canAdminister).toBe(true);
    expect(canManage(user, { ownerId: user.id, createdBy: admin.id })).toBe(true);
    expect(canManage(investigator, { ownerId: investigator.id })).toBe(false);
  });
});
