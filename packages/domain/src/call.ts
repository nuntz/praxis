/**
 * A Call (section 6, ADR 0021): a live spoken exchange the person starts and ends by hand inside
 * one Context's Conversation. What is said in it is sent as Messages, kept as text; no sound is
 * kept anywhere. The Context's object sets it up at the voice provider and keeps a record of it
 * that holds no words.
 */

/**
 * How a Call ended, as the Device reported it or the object found it: the person hung up; the
 * provider ended it itself, at its session limit or by its safety filter; the Device lost its
 * connection to the provider; or another Call started in the Context took its place.
 */
export type CallEnd = "hung_up" | "provider_ended" | "lost" | "replaced";

/** The ways a Device reports a Call ended (`end_call`). */
export const CALL_ENDS_REPORTED = ["hung_up", "provider_ended", "lost"] as const;

/**
 * What was heard of the voice provider ending a Call's session: the reason it gave, if any, such
 * as `close_requested`, `expired` or `content`. Null where nothing was heard.
 */
export type ProviderEnd = { reason: string | null } | null;

/** Who heard the provider end a session: the Device, on its own channel, or the object. */
export type EndHeardBy = "device" | "object";

/**
 * A Call's record (section 6): when it was set up, when and how it ended, and the provider's own
 * reason when it ended the session, as the Device heard it or, when the Device did not, the
 * object did on the provider's side channel. It holds no words.
 */
export type CallRecord = {
  id: string;
  /** When the object set it up, as an ISO 8601 instant. */
  at: string;
  /** When its end was reported, or null while it goes on. */
  ended_at: string | null;
  ended: CallEnd | null;
  /** Why the provider says it ended the session, such as `close_requested` or `content`. */
  provider_reason: string | null;
  /**
   * Who heard the provider end it: the Device, on its own channel, or the object, which ended it
   * on the side channel since the Device had not; null while it goes on, or when neither did.
   */
  end_heard_by: EndHeardBy | null;
};

/**
 * What `start_call` answers the Device with: the Call's id, and the provider's answer to the
 * Device's offer, which connects the Device to the provider. Never the voice key.
 */
export type CallStarted = { id: string; answer: string };

/**
 * The only events the Device may send the voice provider (section 6): the Agent's answer, under
 * the handover it answers, and the end of the Call. The object sets the session to refuse every
 * other from the Device, and the Device's own code sends no other.
 */
export const DEVICE_SENDS = ["session.commentary.append", "session.close"] as const;

/**
 * The most one part of the Agent's answer holds, in characters. The provider takes at most 500
 * tokens in each, which is some 2,000 characters of English and fewer of some languages: well
 * under keeps every part in.
 */
export const SPOKEN_PART = 1000;

/**
 * The Agent's answer split at its sentences into the parts the provider takes (section 6), each at
 * most `SPOKEN_PART` characters, in order, together holding every word of it. A sentence longer
 * than a part is split between its words, and a word longer still between its characters.
 */
export function spokenParts(words: string, most = SPOKEN_PART): string[] {
  const sentences = words
    .trim()
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
  const pieces = sentences.flatMap((sentence) => cut(sentence, most));
  const parts: string[] = [];
  for (const piece of pieces) {
    const last = parts.at(-1);
    if (last !== undefined && last.length + 1 + piece.length <= most) {
      parts[parts.length - 1] = `${last} ${piece}`;
    } else {
      parts.push(piece);
    }
  }
  return parts;
}

/** A sentence cut between its words into pieces of at most `most` characters. */
function cut(sentence: string, most: number): string[] {
  if (sentence.length <= most) return [sentence];
  const pieces: string[] = [];
  let piece = "";
  for (const word of sentence.split(/\s+/u)) {
    for (let at = 0; at < word.length; at += most) {
      const part = word.slice(at, at + most);
      if (piece === "") piece = part;
      else if (piece.length + 1 + part.length <= most) piece = `${piece} ${part}`;
      else {
        pieces.push(piece);
        piece = part;
      }
    }
  }
  if (piece !== "") pieces.push(piece);
  return pieces;
}
