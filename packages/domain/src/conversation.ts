import { z } from "zod";
import type { Caller, CallerKind } from "./callers.ts";
import type { Effect } from "./effects.ts";
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

/** What started a Run. Only a Message from the person, for now; the clock starts Briefs and Reviews. */
export type RunStart = "message";

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
   */
  agent: "available" | NoAgent;
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
  list_messages: MessagesPage;
};

export function parseConversationToolInput<N extends ConversationToolName>(
  name: N,
  input: unknown,
): Parsed<ConversationToolInput<N>> {
  return parseInput(conversationTools[name].input, input);
}
