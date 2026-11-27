import type { Anchor, NewLink } from "@praxis/domain";
import { createSignal } from "solid-js";
import type { Aim } from "./next-task.ts";

// What the Journal's composer holds for the person beyond its own Context's screen: its draft,
// which goes with the person to another Context, whether it is to take the caret as it next shows,
// as the shortcut and the share sheet open it, and what was shared into it and not yet added to
// its words (section 8.9). None of it is stored: a draft is lost with the screen, as before.

/** A link picked in the draft, followed through what is typed after it. */
export type Pick = { to: NewLink["to"]; anchor: Anchor };

/**
 * The composer's draft as it last showed: the Context it was in, its words, its links, whether
 * links it had in another Context were left off, which the person is told as long as it shows,
 * and the Project its next Entry is aimed at, if one is.
 */
type Draft = { context: string; words: string; picks: Pick[]; leftOff: boolean; aim: Aim | null };

let kept: Draft | null = null;

/** Keep the composer's draft as it stops showing, in the Context it was in. */
export function keepDraft(draft: Draft) {
  kept = draft;
}

/**
 * The draft the composer shows in a Context: the one kept, its words whichever Context they were
 * written in, since the person may change the Context before sending (section 8.9). Its links
 * come only within the Context they were picked in, since each is to a record there and nothing
 * crosses a Context (ADR 0003): `leftOff` says some were left. Its aim, at a Project there, ends
 * with the Context too.
 */
export function takeDraft(context: string): Omit<Draft, "context"> {
  const draft = kept;
  kept = null;
  if (!draft) return { words: "", picks: [], leftOff: false, aim: null };
  const { words, picks, leftOff, aim } = draft;
  if (draft.context === context) return { words, picks, leftOff, aim };
  return { words, picks: [], leftOff: leftOff || picks.length > 0, aim: null };
}

const [caretWanted, setCaretWanted] = createSignal(false);
const [shared, setShared] = createSignal<string | null>(null);

/** Have the composer take the caret as it next shows, or now if it is shown. */
export function wantComposer() {
  setCaretWanted(true);
}

/** Whether the composer is to take the caret, which it then has: asked once, it is given once. */
export function takeCaret(): boolean {
  if (!caretWanted()) return false;
  setCaretWanted(false);
  return true;
}

/** Add what an app shared to the composer's words as it next shows, giving it the caret. */
export function receiveShared(text: string) {
  setShared((waiting) => (waiting === null ? text : `${waiting}\n${text}`));
  wantComposer();
}

/** What was shared and not yet added to the composer's words, which it then is. */
export function takeShared(): string | null {
  const text = shared();
  if (text !== null) setShared(null);
  return text;
}

/**
 * Words with what was shared added: on a line after a draft already there, which it never
 * replaces (section 8.9).
 */
export function withShared(draft: string, text: string): string {
  if (draft === "") return text;
  return draft.endsWith("\n") ? `${draft}${text}` : `${draft}\n${text}`;
}
