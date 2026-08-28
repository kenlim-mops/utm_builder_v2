import { describe, expect, it } from "vitest";
import { parseCsv, parseTsv, safeCell, toCsv } from "@/core/csv";

describe("csv", () => {
  it("round-trips quoted fields", () => {
    const rows = parseCsv('a,"b,c","d""e"\n1,2,3');
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "3"],
    ]);
  });

  it("parses spreadsheet paste (TSV)", () => {
    expect(parseTsv("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("neutralizes formula injection on export", () => {
    expect(safeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeCell("+1")).toBe("'+1");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("https://x")).toBe("https://x");
    const csv = toCsv([["=SUM(A1)"]]);
    expect(csv.startsWith("\"'=SUM")).toBe(false);
    expect(csv).toBe("'=SUM(A1)");
  });
});
