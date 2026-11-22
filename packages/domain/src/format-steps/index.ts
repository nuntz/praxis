import formatStep2 from "./format-0002.ts";

/**
 * One step of the Export format's ladder (section 11, ADR 0018): it brings a file of an Export
 * from the format before its number to its number, as a restore reads it, given the file as JSON
 * read it and before it is checked. Each lives in a file of its own, numbered by the format it
 * reaches, which imports nothing and is never edited once released: `lint/format-steps.test.ts`
 * holds each to the hash `released.json` keeps of it. Format 1 has no step, since nothing comes
 * before it.
 */
export type FormatStep = (file: Record<string, unknown>) => Record<string, unknown>;

/** The ladder, the step reaching format 2 first. A new step goes at the end, in a file of its own. */
export const FORMAT_STEPS: readonly FormatStep[] = [formatStep2];
