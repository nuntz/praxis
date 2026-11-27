import { type JSX, onCleanup, Show } from "solid-js";

/**
 * The main screen's ways past what stands before the composers (section 8.11): skip links as its
 * first Tab stops, and outside a field, `r` to the Journal's composer, `m` to the Conversation's
 * and `a` to Attention. Where each leads at each width is the screen's to say.
 */
export type KeyTargets = {
  /** Give the Journal's composer the caret, its column shown first. */
  toJournalComposer: () => boolean;
  /** Give the Conversation's composer the caret, its column shown first. */
  toConversationComposer: () => boolean;
  /** Bring Attention into view, the focus on its heading. */
  toAttention: () => boolean;
};

/** The ids of the two composers' fields, which the skip links and the keys lead to. */
export const JOURNAL_COMPOSER = "new-entry";
export const CONVERSATION_COMPOSER = "new-message";

/** The main screen's letter keys, each declared on what it leads to. */
export type ScreenKey = "r" | "m" | "a";

/**
 * Whether a key goes to where it is typed as text: a field, a composer or the like. A control
 * pressed rather than typed into, as a Task's round checkbox is, is no field.
 */
function typedInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const pressed = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"];
  const field = target.closest("input, textarea, select");
  if (field instanceof HTMLInputElement && pressed.includes(field.type)) return false;
  return target.isContentEditable || field !== null;
}

/**
 * Whether a key pressed is the main screen's to answer, as `/`, `r`, `m` and `a` are: outside a
 * field, with no `Ctrl`, `Meta` or `Alt` held, and not taken first by something on the screen.
 */
export function screenKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  return !typedInto(event.target);
}

/**
 * Follow `r`, `m` and `a` on the document while `live()` holds: each only outside a field, with no
 * `Ctrl`, `Meta` or `Alt` held, and when nothing took it first. A key that reaches what it leads to
 * is taken, so it is not typed into the composer it gave the caret.
 */
export function followScreenKeys(targets: KeyTargets, live: () => boolean) {
  // A key that led somewhere, while it is held: its repeats reach the composer it gave the caret,
  // and are taken too, so holding `r` a moment long types nothing there.
  let held: string | null = null;
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat && event.key === held) {
      event.preventDefault();
      return;
    }
    if (!screenKey(event) || !live()) return;
    const keys: Record<ScreenKey, () => boolean> = {
      r: targets.toJournalComposer,
      m: targets.toConversationComposer,
      a: targets.toAttention,
    };
    const to = keys[event.key as ScreenKey];
    if (to?.()) {
      event.preventDefault();
      held = event.key;
    }
  };
  const onRelease = (event: KeyboardEvent) => {
    if (event.key === held) held = null;
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onRelease);
  onCleanup(() => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onRelease);
  });
}

/**
 * The skip links, the main screen's first Tab stops, out of sight until one is focused. The third
 * opens Attention in between, as its button in the top bar does, and focuses its heading elsewhere.
 * The Conversation's shows only while its composer does: offline or at the cap there is none.
 */
export function SkipLinks(props: {
  targets: KeyTargets;
  attentionOpens: boolean;
  conversationComposerShown: boolean;
}) {
  return (
    <nav class="skip-links" aria-label="Skip links">
      <SkipLink to={JOURNAL_COMPOSER} follow={props.targets.toJournalComposer}>
        Skip to the Journal's composer
      </SkipLink>
      <Show when={props.conversationComposerShown}>
        <SkipLink to={CONVERSATION_COMPOSER} follow={props.targets.toConversationComposer}>
          Skip to the Conversation's composer
        </SkipLink>
      </Show>
      <SkipLink to="attention" follow={props.targets.toAttention}>
        {props.attentionOpens ? "Open Attention" : "Skip to Attention"}
      </SkipLink>
    </nav>
  );
}

/** One skip link: to a place on the screen, which the screen first brings into view. */
function SkipLink(props: { to: string; follow: () => boolean; children: JSX.Element }) {
  return (
    <a
      href={`#${props.to}`}
      onClick={(event) => {
        event.preventDefault();
        props.follow();
      }}
    >
      {props.children}
    </a>
  );
}

/**
 * A composer's key, drawn at the end of its label as search's `/` is, only while it is at rest:
 * one with words, or focused, shows none. Where there is no hover, as on a phone, the stylesheet
 * hides it. The field's own `aria-keyshortcuts` names the key, so this is not read out.
 */
export function ComposerKey(props: { shown: boolean; letter: ScreenKey }) {
  return (
    <Show when={props.shown}>
      <span class="search-key composer-key" aria-hidden="true">
        {props.letter}
      </span>
    </Show>
  );
}
