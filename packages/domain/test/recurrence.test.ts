import { describe, expect, test } from "bun:test";
import { type Interval, nextDueDate, type Recurrence, type Weekday } from "../src/index.ts";

// Recurrence dates are one of the few places with direct tests (section 13): every rule, Due
// Date and closing day is too many for scenarios at the tool seam.

describe("a schedule of every N days", () => {
  // biome-ignore format: read as a table
  test.each([
    ["closed on its Due Date", "2026-11-16", "2026-11-16", "2026-11-17"],
    ["closed a day early", "2026-11-16", "2026-11-15", "2026-11-17"],
    ["closed three days late, skipping those missed", "2026-11-16", "2026-11-19", "2026-11-20"],
  ])("every day, %s", (_, due, closed, next) => {
    const rule = { kind: "days", every: 1, from: "2026-11-16" } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });

  // biome-ignore format: read as a table
  test.each([
    ["on time", "2026-11-16", "2026-11-16", "2026-11-26"],
    ["when the Due Date was moved off it, back on it", "2026-11-19", "2026-11-19", "2026-11-26"],
    ["when the Due Date was moved back before the day counted from", "2026-11-10", "2026-11-10", "2026-11-16"],
    ["closed well after, on the first day after the closing day", "2026-11-16", "2026-12-07", "2026-12-16"],
    ["closed on a day of it, on the next", "2026-11-16", "2026-11-26", "2026-12-06"],
  ])("every ten days counted from the 16th, %s", (_, due, closed, next) => {
    const rule = { kind: "days", every: 10, from: "2026-11-16" } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });
});

describe("a schedule of every N weeks on chosen weekdays", () => {
  // 2026-11-16 is a Monday.
  // biome-ignore format: read as a table
  test.each([
    ["Monday, from Monday", ["monday"], "2026-11-16", "2026-11-16", "2026-11-23"],
    ["Monday and Thursday, from Monday", ["monday", "thursday"], "2026-11-16", "2026-11-16", "2026-11-19"],
    ["Monday and Thursday, from Thursday", ["monday", "thursday"], "2026-11-19", "2026-11-19", "2026-11-23"],
    ["Sunday, from Monday, the same week", ["sunday"], "2026-11-16", "2026-11-16", "2026-11-22"],
    ["Monday, from Wednesday, off it", ["monday"], "2026-11-18", "2026-11-18", "2026-11-23"],
    ["Friday, closed a week late", ["friday"], "2026-11-20", "2026-11-28", "2026-12-04"],
    ["Wednesday across a year", ["wednesday"], "2026-12-30", "2026-12-30", "2027-01-06"],
  ])("every week on %s", (_, on, due, closed, next) => {
    const rule = { kind: "weeks", every: 1, on: on as Weekday[], from: "2026-11-16" } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });

  // biome-ignore format: read as a table
  test.each([
    ["Monday, from Monday", ["monday"], "2026-11-16", "2026-11-16", "2026-11-30"],
    ["Monday and Friday, from Monday, the same week", ["monday", "friday"], "2026-11-16", "2026-11-16", "2026-11-20"],
    ["Monday and Friday, from Friday", ["monday", "friday"], "2026-11-20", "2026-11-20", "2026-11-30"],
    ["Monday, from a Due Date moved into a week off it", ["monday"], "2026-11-25", "2026-11-25", "2026-11-30"],
    ["Monday, closed in a week off it", ["monday"], "2026-11-16", "2026-11-24", "2026-11-30"],
    ["Monday, closed in a week on it, after its Monday", ["monday"], "2026-11-16", "2026-12-01", "2026-12-14"],
  ])("every two weeks counted from the week of the 16th on %s", (_, on, due, closed, next) => {
    const rule = { kind: "weeks", every: 2, on: on as Weekday[], from: "2026-11-16" } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });

  test("counts its weeks from Monday, whatever weekday it counts from", () => {
    // 2026-11-22 is the Sunday ending the week of the 16th.
    const rule: Recurrence = { kind: "weeks", every: 2, on: ["monday"], from: "2026-11-22" };
    expect(nextDueDate(rule, "2026-11-22", "2026-11-22")).toBe("2026-11-30");
  });
});

describe("a schedule of every N months", () => {
  // biome-ignore format: read as a table
  test.each([
    ["the 15th, from the 15th", 15, "2026-11-15", "2026-11-15", "2026-12-15"],
    ["the 15th, from the 10th, the same month", 15, "2026-11-10", "2026-11-10", "2026-11-15"],
    ["the 31st, onto the last day of a month that lacks it", 31, "2026-01-31", "2026-01-31", "2026-02-28"],
    ["the 31st, back on the 31st after a short month", 31, "2026-02-28", "2026-02-28", "2026-03-31"],
    ["the 30th, onto a leap day", 30, "2028-01-30", "2028-01-30", "2028-02-29"],
    ["the last day, from the last day", "last", "2026-11-30", "2026-11-30", "2026-12-31"],
    ["the last day, into February", "last", "2027-01-31", "2027-01-31", "2027-02-28"],
    ["the 1st, across a year", 1, "2026-12-01", "2026-12-01", "2027-01-01"],
    ["the 15th, closed two months late", 15, "2026-11-15", "2027-01-20", "2027-02-15"],
  ])("every month on %s", (_, on, due, closed, next) => {
    const rule = { kind: "months", every: 1, on: on as number | "last", from: due } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });

  // biome-ignore format: read as a table
  test.each([
    ["on time", "2026-11-15", "2026-11-15", "2027-02-15"],
    ["when the Due Date was moved into a month off it", "2026-12-15", "2026-12-15", "2027-02-15"],
    ["closed in a month on it, after its day", "2026-11-15", "2027-02-20", "2027-05-15"],
  ])("every three months on the 15th counted from November, %s", (_, due, closed, next) => {
    const rule = { kind: "months", every: 3, on: 15, from: "2026-11-15" } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });
});

describe("a schedule of every N years", () => {
  // biome-ignore format: read as a table
  test.each([
    ["every year on time", 1, "2026-11-15", "2026-11-15", "2026-11-15", "2027-11-15"],
    ["every year closed late, past the day", 1, "2026-03-01", "2026-03-01", "2027-03-05", "2028-03-01"],
    ["every year from a leap day, onto the last of February", 1, "2028-02-29", "2028-02-29", "2028-02-29", "2029-02-28"],
    ["every year from a leap day, back onto one", 1, "2028-02-29", "2031-02-28", "2031-02-28", "2032-02-29"],
    ["every two years on time", 2, "2026-11-15", "2026-11-15", "2026-11-15", "2028-11-15"],
    ["every two years from a Due Date moved a year on", 2, "2026-11-15", "2027-11-15", "2027-11-15", "2028-11-15"],
  ])("%s", (_, every, from, due, closed, next) => {
    const rule = { kind: "years", every, from } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });
});

describe("an interval counted from the closing day", () => {
  // biome-ignore format: read as a table
  test.each([
    ["three days", 3, "days", "2026-11-20", "2026-11-15", "2026-11-18"],
    ["three days, closed late", 3, "days", "2026-11-15", "2026-11-20", "2026-11-23"],
    ["two weeks", 2, "weeks", "2026-11-15", "2026-11-17", "2026-12-01"],
    ["a month", 1, "months", "2026-11-15", "2026-11-15", "2026-12-15"],
    ["a month from the 31st, onto the last day", 1, "months", "2026-01-31", "2026-01-31", "2026-02-28"],
    ["six months, across a year", 6, "months", "2026-11-15", "2026-11-30", "2027-05-30"],
    ["a year from a leap day", 1, "years", "2028-02-29", "2028-02-29", "2029-02-28"],
  ])("of %s", (_, every, unit, due, closed, next) => {
    const rule = { kind: "interval", every, unit: unit as Interval["unit"] } as const;
    expect(nextDueDate(rule, due, closed)).toBe(next);
  });
});
