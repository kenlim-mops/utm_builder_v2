import { describe, expect, it } from "vitest";
import { ID_PREFIXES, idKindOf, isValidId, newId } from "@/core/ids";

describe("identifier scheme", () => {
  it("generates prefixed ULIDs for every kind", () => {
    for (const kind of Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[]) {
      const id = newId(kind);
      expect(id).toMatch(new RegExp(`^${ID_PREFIXES[kind]}_[0-9A-HJKMNP-TV-Z]{26}$`));
      expect(isValidId(kind, id)).toBe(true);
      expect(idKindOf(id)).toBe(kind);
    }
  });

  it("is collision-resistant across many generations", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId("link")));
    expect(ids.size).toBe(5000);
  });

  it("rejects wrong prefixes and malformed ULIDs", () => {
    expect(isValidId("campaign", "rpl_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false);
    expect(isValidId("campaign", "rpc_notaulid")).toBe(false);
    expect(idKindOf("42")).toBeNull();
  });
});
