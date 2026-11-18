import type { Effect } from "./effects.ts";
import type { InTheWay } from "./results.ts";

/**
 * The cap a Deployment has before the person sets one, in US dollars a month. There is always a
 * cap (section 5.7): setup asks for it and offers this.
 */
export const DEFAULT_SPEND_CAP = 20;

/** The share of the cap past which the cap is nearly reached, a standing Notice (section 5.7). */
export const WARNING_SHARE = 0.8;

/**
 * The standing Notice the month's spend gives, if any: the cap nearly reached once the spend passes
 * 80% of it, which is the spec's warning, and the cap reached, when no new Run starts.
 */
export type SpendNotice = "nearing_cap" | "cap_reached";

/** What the Deployment has spent this calendar month, against its cap, in US dollars. */
export type Spend = {
  /** The calendar month, in UTC, as YYYY-MM. */
  month: string;
  spent: number;
  cap: number;
  notice: SpendNotice | null;
};

/** The cap as `set_spend_cap` returns it: not a record, but a change to it is an Effect. */
export type SpendCap = { cap: number };

/** The standing Notice a month's spend gives against the cap. */
export function spendNotice(spent: number, cap: number): SpendNotice | null {
  if (spent >= cap) return "cap_reached";
  if (spent >= cap * WARNING_SHARE) return "nearing_cap";
  return null;
}

/**
 * The calendar month an instant falls in, in UTC, as YYYY-MM. The cap is the whole Deployment's,
 * and its Contexts may each keep another time zone, so its month is UTC's.
 */
export function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

/** The first instant of the calendar month an instant falls in, and of the month after, in UTC. */
export function monthBounds(at: number): { start: number; end: number } {
  const date = new Date(at);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) };
}

/** An amount in US dollars as people read it: "20 US dollars", "12.50 US dollars". */
export function dollars(amount: number): string {
  const shown = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${shown} US dollars`;
}

/** The id an Effect on the cap carries: there is one cap, the Deployment's. */
export const SPEND_CAP_ID = "spend_cap";

/** An Effect on the cap, summarised by what it is now. */
export function effectOnSpendCap(cap: number): Effect {
  return {
    kind: "spend_cap",
    id: SPEND_CAP_ID,
    what: "changed",
    summary: `${dollars(cap)} a month`,
    by: "call",
  };
}

/** The cap as a thing in the way of a Run, when the month's spend has reached it. */
export function capInTheWay(cap: number): InTheWay {
  return { kind: "spend_cap", id: SPEND_CAP_ID, summary: `${dollars(cap)} a month` };
}
