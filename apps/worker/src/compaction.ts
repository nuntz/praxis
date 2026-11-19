import type { Message as ModelMessage } from "@earendil-works/pi-ai";

/**
 * The summary that stands in for the older part of the Conversation once it is compacted (section
 * 5.5, ADR 0016). Praxis supplies it: the model writes it on these instructions, in place of the
 * runtime's own, and the Agent adds the Held Changes still waiting itself. It may lose anything, so
 * no fact may live only there.
 */

/** Who the model is while it writes the summary. */
export const COMPACTION_SYSTEM =
  "You summarize the older part of a Conversation between a person and the Agent of Praxis, a journal-centric task manager, so the Agent can carry on from the summary. Do not continue the Conversation or answer anything in it: write only the summary.";

/** What the summary is to carry, and what not. */
const COMPACTION_PROMPT = `Above is the older part of the Conversation, which this summary replaces. If it opens with an earlier summary, fold that in.

Carry only what is in flight:
- what the person was last working on;
- questions the person asked that were left unanswered, and questions the Agent asked that the person has not yet answered.

Name records (Entries, Tasks, Projects, Persons) by their kind and id, as the tool calls and results show them, and never restate what they hold: the Journal keeps that, and the Agent reads it through its tools. Leave out what is done and settled, and anything the Journal already records. Do not list Held Changes: Praxis adds the ones still waiting itself. Keep it short.`;

/** The longest a tool result is shown at, in the Conversation the model summarizes. */
const RESULT_CHARACTERS = 2_000;

/**
 * The request that asks the model for the summary of these messages of the Conversation, stamped
 * `at` the newest of them, since nothing here reads the clock.
 */
export function summaryRequest(messages: readonly ModelMessage[], at: number): ModelMessage[] {
  return [
    { role: "system", content: COMPACTION_SYSTEM, timestamp: at },
    {
      role: "user",
      content: [{ type: "text", text: `${transcript(messages)}\n\n${COMPACTION_PROMPT}` }],
      timestamp: at,
    },
  ];
}

/**
 * The messages as plain text, so the model reads a transcript instead of carrying it on. The
 * Agent's own instructions are left out, and long tool results are cut short.
 */
function transcript(messages: readonly ModelMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        lines.push(`[The person]: ${textOf(message.content)}`);
        break;
      case "assistant":
        for (const block of message.content) {
          if (block.type === "text" && block.text.trim() !== "") {
            lines.push(`[The Agent]: ${block.text}`);
          } else if (block.type === "toolCall") {
            lines.push(`[The Agent called ${block.name}]: ${JSON.stringify(block.arguments)}`);
          }
        }
        break;
      case "toolResult": {
        const text = textOf(message.content);
        const shown =
          text.length > RESULT_CHARACTERS ? `${text.slice(0, RESULT_CHARACTERS)} […]` : text;
        lines.push(`[${message.toolName} answered]: ${shown}`);
        break;
      }
    }
  }
  return `<conversation>\n${lines.join("\n\n")}\n</conversation>`;
}

function textOf(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("");
}
