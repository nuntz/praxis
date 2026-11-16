/** The five callers of section 4.2. Which tool each is offered is metadata of the tool. */
export const CALLERS = ["hand", "agent", "clock", "connection", "read_only_connection"] as const;

export type CallerKind = (typeof CALLERS)[number];

/**
 * A caller. A Connection is told apart by its id, the opaque one in its address (section 7.2),
 * and carries the name it had when it called, which is the Author of what it makes.
 */
export type Caller =
  | { kind: "hand" }
  | { kind: "agent" }
  | { kind: "clock" }
  | { kind: "connection"; id: string; name: string }
  | { kind: "read_only_connection"; id: string; name: string };

/** Who made a record. Stamped by the tool layer from the caller, never stated by it. */
export type Author = { kind: "person" } | { kind: "agent" } | { kind: "connection"; name: string };

/**
 * The Author a write by this caller is stamped with. The Clock and a Read-only Connection are
 * offered no writes, so they never author anything.
 */
export function authorOf(caller: Caller): Author {
  switch (caller.kind) {
    case "hand":
      return { kind: "person" };
    case "agent":
      // Not final: an Entry holding the person's words verbatim is the person's, and only one
      // the Agent composed when asked is its own (section 3.2). Settled with the Agent's Runs.
      return { kind: "agent" };
    case "connection":
      return { kind: "connection", name: caller.name };
    case "clock":
    case "read_only_connection":
      throw new Error(`The ${caller.kind} caller is offered no writes`);
  }
}
