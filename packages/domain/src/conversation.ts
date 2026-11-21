import { z } from "zod";
import { CALL_ENDS_REPORTED, type CallRecord, type CallStarted } from "./call.ts";
import type { Caller, CallerKind } from "./callers.ts";
import type { ClockKind } from "./clock.ts";
import type { Effect } from "./effects.ts";
import type { ExportedRun } from "./export.ts";
import type { RunNotice } from "./notice.ts";
import type { ErrorCode } from "./results.ts";
import { type Parsed, parseInput, writeInput } from "./tools.ts";

/**
 * A Message from the person: one turn of theirs in the Conversation, shown as typed. A Message is
 * never an Entry (section 4.12).
 */
export type PersonMessage = {
  id: string;
  from: "person";
  words: string;
  /** When it was sent, as an ISO 8601 instant. */
  at: string;
  /** Whether it was spoken in a Call rather than typed. */
  spoken: boolean;
  /**
   * The Notice under it while its newest Run has failed, with a way to try again: never a
   * Message, and nothing answers it later by itself (section 5.6).
   */
  notice: RunNotice | null;
};

/**
 * A Message from the Agent: what it said in a Run, with the Run's calls folded under it (section
 * 8.5). Its words are shown as an Entry's are, except that an image never loads.
 */
export type AgentMessage = {
  id: string;
  from: "agent";
  words: string;
  run: RunFold;
  /**
   * The person's Message it answers, by its id, once its Run is known; null for a Brief or a
   * Review. In a Call the Device passes it back to be spoken under the handover that Message was
   * sent for (section 6).
   */
  answers: string | null;
  /** For a Brief or a Review, what it is and when it was taken; null for an answer to the person. */
  clock: ClockFold | null;
};

/**
 * A Brief or a Review as the Conversation shows it (section 8.5): which it is, when it was taken,
 * whether it has been read, and how many of the Tasks it names have been finished since, which it
 * says once there are any.
 */
export type ClockFold = {
  kind: ClockKind;
  /** When the clock's Run started, as an ISO 8601 instant. */
  taken: string;
  /** Whether Praxis has shown it in a focused window on any Device, held once per Context. */
  read: boolean;
  finished_since: number;
};

export type Message = PersonMessage | AgentMessage;

/**
 * A Run as it folds under the Message it left: its calls, and once it has ended, its cost. It holds
 * the Effects of each change so the screen can link to the record, and nothing of what was said.
 */
export type RunFold = {
  id: string;
  calls: RunCall[];
  /** How it ended, or null while it is going. */
  ended: RunEnd | null;
  /** What the Run cost, in US dollars, once it has ended. */
  cost: number | null;
};

/**
 * One tool call of a Run: the tool, how it went (its error's code, or still running), and the
 * Effects of a write that changed something.
 */
export type RunCall = { tool: string; result: "ok" | ErrorCode | "running"; effects: Effect[] };

/**
 * How a Run ended: it answered, it was cut short at the limit of model rounds (section 5.2), it
 * failed and the person may try again, or it never started because the month's spend had reached
 * the cap (section 5.7), which still leaves a record.
 */
export type RunEnd = "answered" | "cut_short" | "failed" | "cap_reached";

/** What started a Run: a Message from the person, or the clock, for a Brief or a Review. */
export type RunStart = "message" | ClockKind;

/**
 * A change a Run made, as its record holds it (section 5.8): when, the tool, and what it changed,
 * each by kind and id, none of the words.
 */
export type RunChange = {
  /** When the call arrived, as an ISO 8601 instant. */
  at: string;
  tool: string;
  changed: Omit<Effect, "summary">[];
};

/**
 * A Run record (section 5.8, ADR 0010): what started the Run, when, the model, tokens, cost, how
 * it ended and which changes it made, and never its words. Kept for good, as an Export holds it,
 * with the changes the change log still keeps: after its 90 days a change is gone from it, and is
 * only counted.
 */
export type RunRecord = ExportedRun & {
  /** The changes it made that the change log still keeps, oldest first. */
  changes: RunChange[];
  /** How many changes it made that the change log no longer keeps. */
  changes_gone: number;
};

/**
 * Why a Deployment has no Agent (ADR 0017): its configuration gives no key for the model, or names
 * a model the code ships no price for, which the deploy is meant to have refused.
 */
export type NoAgent = "no_key" | "model_has_no_price";

/** A page of the Conversation, newest Message first, read back to the start by cursor. */
export type MessagesPage = {
  items: Message[];
  next_cursor: string | null;
  /**
   * Whether there is an Agent at all: without the model's key there is none, and the Conversation
   * says so in place of its composer (ADR 0017). Whether the cap lets a Run start is `get_spend`'s.
   * `unavailable` when the runtime cannot open this Conversation's tables under this release: the
   * Conversation shows as unavailable, and the Journal is untouched (section 11).
   */
  agent: "available" | NoAgent | "unavailable";
  /**
   * Whether a Call can be started here as far as the voice key goes: without one there is no way
   * to start a Call, and nothing is shown as broken (section 6). Without an Agent there is none
   * either, whatever this says.
   */
  voice: "available" | "no_key";
};

/** The words of a Message: what the person typed or said, never empty. */
const words = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Message needs words." });

/**
 * The Conversation tools (section 4.12). They run inside a Context's object and are offered to the
 * person's hand only, never to the Agent, the Clock or a Connection. They return no Effects and
 * write nothing to the change log, because the Conversation is not data.
 */
export const conversationTools = {
  send_message: {
    kind: "write",
    description:
      "Send the person's Message to the Agent in this Context's Conversation. It starts a Run, which answers on the live channel; the answer is not this tool's result, and is read back with list_messages.",
    input: writeInput({ words, spoken: z.boolean().optional() }),
  },
  retry_run: {
    kind: "write",
    description:
      "Try a Run that failed again, from the person's Message it was answering, as a new Run. Only the newest Message's Run can be: a Message sent since has moved the Conversation on. It is refused while a Run is going, and at the spend cap as send_message is.",
    input: writeInput({ run: z.string().min(1) }),
  },
  note_shown: {
    kind: "write",
    description:
      "Note that Praxis has shown a Brief or a Review, by its Message's id, in a focused window on this Device: it is then read, once for the Context and on every Device, and a newer one no longer replaces it. The screen calls it; the person never marks one read. Noting one again changes nothing.",
    input: writeInput({ message: z.string().min(1) }),
  },
  start_call: {
    kind: "write",
    description:
      "Set a Call up in this Context (section 6): the Context's object asks the voice provider for a session, with the voice model and its instructions, which the Device cannot change, and answers the Device's WebRTC offer with the provider's answer. The sound then travels between the Device and the provider. Refused without the voice key or the Agent's, and at the spend cap. Starting one ends any other going in the Deployment, in whichever Context.",
    input: writeInput({
      offer: z
        .string()
        .min(1)
        .max(100_000, { message: "The offer is longer than a WebRTC offer is." }),
    }),
  },
  note_call_alive: {
    kind: "write",
    description:
      "The Device in a Call sends a sign of life every 15 seconds while it goes on (section 6). Answers with the Call's record: once it has ended, as when the object ended it at the cap, the Device ends its end of it too. When none comes for 45 seconds, the object ends the Call at the provider itself. The screen calls it; the person never does by a tap.",
    input: writeInput({ call: z.string().min(1) }),
  },
  end_call: {
    kind: "write",
    description:
      "Report that a Call has ended, how, and what the Device heard of the provider ending its session: the reason it gave, which may be none, or null when the Device heard nothing, and the object then ends the session at the provider itself. Reporting one already ended changes nothing.",
    input: writeInput({
      call: z.string().min(1),
      ended: z.enum(CALL_ENDS_REPORTED),
      provider_end: z
        .strictObject({
          reason: z
            .string()
            .regex(/^[a-z_]{1,64}$/, { message: "The provider's reason is a word of its own." })
            .nullable(),
        })
        .nullable(),
    }),
  },
  list_messages: {
    kind: "read",
    description:
      "List this Context's Conversation, newest Message first, back to the start by cursor, each Agent Message with its Run's calls folded under it, and the Notice under a person's Message whose Run failed. Says whether there is an Agent at all.",
    input: z.strictObject({
      cursor: z
        .string()
        .regex(/^[1-9][0-9]*$/, { message: "The cursor is not one list_messages gave." })
        .optional(),
    }),
  },
} as const;

export type ConversationToolName = keyof typeof conversationTools;

export const conversationToolNames = Object.keys(conversationTools) as ConversationToolName[];

export function isConversationToolName(name: string): name is ConversationToolName {
  return Object.hasOwn(conversationTools, name);
}

/** Every Conversation tool is offered to the person's hand, and to no other caller. */
export function offeredConversationTool(caller: Caller | CallerKind): boolean {
  return (typeof caller === "string" ? caller : caller.kind) === "hand";
}

export type ConversationToolInput<N extends ConversationToolName> = z.infer<
  (typeof conversationTools)[N]["input"]
>;

/** What each Conversation tool returns on success. */
export type ConversationToolOutput = {
  /** The person's Message as it was added. The answer comes on the live channel. */
  send_message: { message: PersonMessage };
  /** The person's Message being answered again, its Notice gone. The answer comes on the live channel. */
  retry_run: { message: PersonMessage };
  /** The Brief or Review now read, by its Message's id. */
  note_shown: { message: string; read: true };
  /** The Call set up, and the provider's answer to the Device's offer. */
  start_call: { call: CallStarted };
  /** The Call's record, now it has ended. */
  end_call: { call: CallRecord };
  /** The Call's record as it stands: ended null while it goes on. */
  note_call_alive: { call: CallRecord };
  list_messages: MessagesPage;
};

export function parseConversationToolInput<N extends ConversationToolName>(
  name: N,
  input: unknown,
): Parsed<ConversationToolInput<N>> {
  return parseInput(conversationTools[name].input, input);
}

/**
 * Where the screen opens on a Context's Conversation: the address a Notification's tap opens
 * (section 8.7), which the screen reads as it starts.
 */
export function conversationAddress(contextId: string): string {
  return `/?context=${encodeURIComponent(contextId)}&peer=conversation`;
}

/** The Context whose Conversation an address of `conversationAddress` opens, or null for another. */
export function conversationOpened(search: string): string | null {
  // The domain package runs anywhere, so it reads the address with no URL API.
  const params = new Map(
    search
      .replace(/^\?/, "")
      .split("&")
      .map((pair): [string, string] => {
        const [name = "", given = ""] = pair.split("=");
        return [name, given];
      }),
  );
  const context = params.get("context");
  if (params.get("peer") !== "conversation" || !context) return null;
  try {
    return decodeURIComponent(context);
  } catch {
    return null;
  }
}

/**
 * A Run Transcript (section 5.8, ADR 0010): a file the person saves of one Run, by hand, for
 * debugging. It holds what the Agent was given, said and called: the prompt and the tools it was
 * offered, the Message it answered as the model was shown it, bearings and all, each answer of the
 * model with its calls, and each call's result. It is the only way a Conversation's text leaves
 * Praxis, and it is not an Export. Instants are ISO 8601.
 */
export type RunTranscript = {
  kind: "run_transcript";
  made_at: string;
  context: { id: string; name: string };
  run: RunRecord;
  /** What the model is told of itself every Run, the same each time. */
  prompt: string;
  /** The tools it was offered: a Brief's or a Review's are the reads alone. */
  tools: string[];
  messages: TranscriptMessage[];
};

/**
 * One message of a Run as the model saw it: what it was given (a Message, a Brief's or a Review's
 * instructions, or the summary standing in for the older Conversation), what it answered with its
 * calls and why it stopped, or a call's result as it was handed back.
 */
export type TranscriptMessage =
  | { role: "user"; at: string; text: string }
  | {
      role: "assistant";
      at: string;
      text: string;
      calls: { id: string; tool: string; input: unknown }[];
      /** Why the model stopped: an answer, a call, or the provider's error. */
      stop: string;
      /** The provider's error, for an answer that is one. */
      error: string | null;
    }
  | { role: "tool_result"; at: string; call: string; tool: string; text: string; error: boolean }
  | { role: "system"; at: string; text: string };

/** The name a Run Transcript is saved as: the Run's start and its id, never any of its words. */
export function runTranscriptName(transcript: RunTranscript): string {
  const at = transcript.run.at.replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
  return `praxis-run-${at}-${transcript.run.id.slice(0, 8)}.json`;
}
