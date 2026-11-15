/**
 * The offering table of section 4.10 (ADR 0015), kept by hand and never derived from the
 * registry, so a change in who is offered what always shows as a diff to this file. One row per
 * tool in the registry, one column per caller, in the order of `everyCaller`. It grows a row with each tool and must equal the
 * spec's table for the tools it has.
 */
export type Offer = "yes" | "no";

// biome-ignore format: read as a table
export const offering: Record<string, [Offer, Offer, Offer, Offer, Offer]> = {
  //               hand   agent  clock  connection  read-only connection
  record_entry: [  "yes", "yes", "no",  "yes",      "no"  ],
  get_entry: [     "yes", "yes", "yes", "yes",      "yes" ],
  list_entries: [  "yes", "yes", "yes", "yes",      "yes" ],
  list_changes: [  "yes", "yes", "yes", "yes",      "yes" ],
};
