import type { Message } from "./conversation.ts";
import type { Change } from "./effects.ts";

/**
 * What the live channel carries down to the screen (section 9.5). Nothing travels up it.
 *
 * - `changes`: changes in the Context, as `list_changes` gives them, with the cursor standing after
 *   them. The first message on opening holds none, and says where the change log stands.
 * - `answer`: the Agent's answer as it is being written in the Run going now: all of it so far,
 *   so a screen that joins part-way shows it whole from then on. It is not kept.
 * - `message`: a Message now whole in the Conversation, as `list_messages` would give it, placed by
 *   its id. A Message missed while away is read with `list_messages`.
 */
export type LiveMessage =
  | { kind: "changes"; items: Change[]; cursor: string }
  | { kind: "answer"; words: string }
  | { kind: "message"; message: Message };

/** A message of the live channel carrying changes. */
export type LiveChanges = Extract<LiveMessage, { kind: "changes" }>;

/** The close code of a channel something was sent up: every send is a tool call. */
export const NOTHING_GOES_UP = 1003;
