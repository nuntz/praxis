import type { Change } from "./effects.ts";

/**
 * What the live channel carries down to the screen (section 9.5). Nothing travels up it.
 *
 * Changes in the Context, as `list_changes` gives them, with the cursor standing after them. The
 * first message on opening holds none, and says where the change log stands.
 */
export type LiveMessage = { kind: "changes"; items: Change[]; cursor: string };

/** The close code of a channel something was sent up: every send is a tool call. */
export const NOTHING_GOES_UP = 1003;
