/** Shared test fixtures: fresh DB, actors, fake integration clients. */
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import type { SessionUser } from "@/services/auth";
import type { IntegrationClients } from "@/services/outbox";

export async function freshDb(): Promise<Db> {
  return createTestDb();
}

export async function actorByEmail(db: Db, email: string): Promise<SessionUser> {
  const rows = await db.select().from(users).where(eq(users.email, email));
  const u = rows[0];
  if (!u) throw new Error(`Seeded user missing: ${email}`);
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export const adminActor = (db: Db) => actorByEmail(db, "dev-admin@runpod.io");
export const userActor = (db: Db) => actorByEmail(db, "dev-user@runpod.io");
export const investigatorActor = (db: Db) => actorByEmail(db, "dev-investigator@runpod.io");

export interface FakeHubspotState {
  calls: { idempotencyKey: string; name: string }[];
  created: Map<string, string>; // name -> guid
  failuresRemaining: number;
  alwaysFail: boolean;
}

/**
 * Idempotent fake HubSpot: repeated ensureCampaign for the same name returns
 * the same GUID. Can simulate transient or permanent outages.
 */
export function fakeClients(
  opts: { hubspotFailures?: number; hubspotAlwaysFail?: boolean } = {},
): { clients: IntegrationClients; hubspot: FakeHubspotState; snapshots: Map<string, unknown> } {
  const hubspot: FakeHubspotState = {
    calls: [],
    created: new Map(),
    failuresRemaining: opts.hubspotFailures ?? 0,
    alwaysFail: opts.hubspotAlwaysFail ?? false,
  };
  const snapshots = new Map<string, unknown>();
  const clients: IntegrationClients = {
    hubspot: {
      async ensureCampaign({ idempotencyKey, name }) {
        hubspot.calls.push({ idempotencyKey, name });
        if (hubspot.alwaysFail || hubspot.failuresRemaining > 0) {
          if (!hubspot.alwaysFail) hubspot.failuresRemaining--;
          throw new Error("Simulated HubSpot outage (503)");
        }
        if (!hubspot.created.has(name)) {
          hubspot.created.set(name, `hs-guid-${hubspot.created.size + 1}`);
        }
        return { campaignGuid: hubspot.created.get(name)! };
      },
    },
    warehouse: {
      async writeSnapshot({ idempotencyKey, payload }) {
        if (!snapshots.has(idempotencyKey)) snapshots.set(idempotencyKey, payload);
      },
    },
  };
  return { clients, hubspot, snapshots };
}
