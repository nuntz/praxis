import { describe, expect, test } from "bun:test";
import { shortDay } from "../src/short-day.ts";

// A day as a row or a mark says it (sections 8.3 and 8.4), in the runner's own locale, so only
// whether the year is written is asserted: a journey sees one today only, and its year.

describe("shortDay", () => {
  test("a day of today's year is said without its year", () => {
    const said = shortDay("2026-03-04", "2026-11-27");
    expect(said).not.toContain("2026");
    expect(said).toContain("4");
  });

  test("a day of another year is said with it", () => {
    expect(shortDay("2025-12-30", "2026-01-02")).toContain("2025");
    expect(shortDay("2027-01-02", "2026-12-30")).toContain("2027");
  });
});
