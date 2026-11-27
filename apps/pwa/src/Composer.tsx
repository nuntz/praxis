import {
  type Entry,
  type EntryNamed,
  followEdit,
  type LinkQuery,
  linkQueryAt,
  pickLink,
} from "@praxis/domain";
import Check from "lucide-solid/icons/check";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { keepDraft, type Pick, takeCaret, takeDraft, takeShared, withShared } from "./draft.ts";
import { ComposerKey, JOURNAL_COMPOSER } from "./keys.tsx";
import { latestRead } from "./latest-read.ts";
import {
  type Choice,
  ChoiceList,
  choiceKeys,
  personsOffered,
  referencesOffered,
} from "./Pickers.tsx";
import { afterPress } from "./press.ts";
import { unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { recordEntry } from "./unsent.ts";

/**
 * The Journal's composer, which records an Entry with no model turn. `@` opens a picker of the
 * Context's Persons and `#` one of its Tasks and Projects. Only a pick makes a link: the editor
 * keeps each beside the words and passes them to `record_entry`, and never matches a name to a
 * record. The Entry it records may be a Follow-up to one the person chose.
 */
export function Composer(props: {
  /** The Context the Entry is recorded in, named on the composer once known. */
  contextName: string | undefined;
  /** The zone the Journal's days and times are shown in, the Context's. */
  timeZone: string;
  /** The earlier Entry the one recorded continues or corrects, if the person chose one. */
  followingUp: EntryNamed | null;
  onStopFollowingUp: () => void;
  onRecorded: (entry: Entry) => void;
  /**
   * The Entry was kept Unsent on this Device, to be sent once Praxis can be reached, and whether
   * its links or the Entry it followed up were left off for that.
   */
  onUnsent: (leftOff: boolean) => void;
  /** The draft came from another Context, and its links stayed there. */
  onLinksLeftOff: () => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const contextId = useContextId();
  let field!: HTMLTextAreaElement;
  // The draft outlives this Context's screen: the person may change the Context before sending.
  const draft = takeDraft(contextId);
  let { leftOff } = draft;
  if (leftOff) props.onLinksLeftOff();
  const [words, setWords] = createSignal(draft.words);
  const [picks, setPicks] = createSignal<Pick[]>(draft.picks);
  const [query, setQuery] = createSignal<LinkQuery | null>(null);
  // Where the picker the person shut with Escape starts, so it stays shut as they type on.
  const [shut, setShut] = createSignal<number | null>(null);
  const [choices, setChoices] = createSignal<Choice[]>([]);
  // The choice Enter or Tab picks. None at first when only a new record is offered, so `@ali`
  // and Enter is text and a new line.
  const [highlight, setHighlight] = createSignal(-1);
  const [sending, setSending] = createSignal(false);
  const canRecord = () => !sending() && words().trim() !== "";
  // At rest, with nothing written, no Follow-up chosen and the focus elsewhere, it folds to one line.
  const [focused, setFocused] = createSignal(false);
  const folded = () => !focused() && words() === "" && !props.followingUp;
  const open = () => query() !== null && choices().length > 0;
  // A draft on its way is no longer the draft: kept, it would show again in the next Context and
  // could be sent twice.
  onCleanup(() => {
    if (!sending()) keepDraft({ context: contextId, words: words(), picks: picks(), leftOff });
  });
  // Opened by the shortcut or the share sheet, the composer has the caret, after what was shared
  // (section 8.9). Nothing is recorded until the person sends it.
  // What is shared while an Entry is on its way waits for it, so clearing the words sent once it
  // is made or kept Unsent keeps what was shared.
  createEffect(() => {
    if (sending()) return;
    const text = takeShared();
    if (text !== null) untrack(() => changeWords(withShared(words(), text)));
    if (!takeCaret()) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });

  /** The words changed by one edit: each pick follows it, and one the edit typed into is lost. */
  function changeWords(after: string) {
    const before = words();
    setPicks((kept) => {
      const followed = followEdit(
        before,
        after,
        kept.map((pick) => pick.anchor),
      );
      return kept.flatMap((pick, i) => {
        const anchor = followed[i];
        return anchor ? [{ ...pick, anchor }] : [];
      });
    });
    setWords(after);
  }

  /** Open, narrow or shut the picker for where the caret now is. */
  function look() {
    const caret = field.selectionStart;
    const found = field.selectionEnd === caret ? linkQueryAt(field.value, caret) : null;
    if (found?.start !== shut()) setShut(null);
    if (!found || found.start === shut()) return shutPicker();
    setQuery(found);
    void offer(found);
  }

  // Each look asks afresh. Only the answer to the latest is shown.
  const { read: offer } = latestRead(async (current, found: LinkQuery) => {
    const typed = found.typed.trim();
    const offered =
      found.kind === "mention"
        ? await personsOffered(callTool, contextId, typed, props.timeZone)
        : await referencesOffered(callTool, contextId, typed, "tasks and projects");
    if ("problem" in offered) return props.onProblem(offered.problem);
    // Shut meanwhile, by Escape or by leaving the words, the query is no longer asked: its
    // answer would show for the next query until that one's own answer lands.
    if (!current() || query() !== found) return;
    // With no network the picker offers what the Offline Copy holds, and makes no new Person or
    // Project, since the Device cannot tell whether one of that name exists (section 8.8).
    const made: Choice[] =
      typed === "" || offered.held
        ? []
        : [
            found.kind === "mention"
              ? { name: typed, detail: null, to: { kind: "new_person", name: typed } }
              : { name: typed, detail: null, to: { kind: "new_project", name: typed } },
          ];
    setChoices([...offered.choices, ...made]);
    setHighlight(offered.choices.length > 0 ? 0 : -1);
  });

  function shutPicker() {
    setQuery(null);
    setChoices([]);
  }

  /** Pick a choice: its name goes into the words, and the link is kept beside them. */
  function choose(choice: Choice) {
    const found = query();
    if (!found) return;
    const picked = pickLink(field.value, found, field.selectionStart, choice.name);
    changeWords(picked.words);
    setPicks((kept) => [...kept, { to: choice.to, anchor: picked.anchor }]);
    shutPicker();
    field.focus();
    field.setSelectionRange(picked.caret, picked.caret);
  }

  async function record() {
    if (!canRecord()) return;
    setSending(true);
    try {
      // The editor finds the Inline Tasks and keeps the links; the server never reads words for them.
      // With no network the Entry is kept Unsent, and capture never fails (section 8.8).
      const outcome = await recordEntry(contextId, {
        words: words(),
        links: picks(),
        follow_up_to: props.followingUp?.id ?? null,
      });
      if (outcome.kind === "refused") return props.onProblem(outcome.message);
      if (outcome.kind === "made") props.onRecorded(outcome.value);
      else props.onUnsent(outcome.leftOff);
      setWords("");
      setPicks([]);
      leftOff = false;
      shutPicker();
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void record();
      return;
    }
    const found = query();
    if (!found) return;
    // Escape shuts a picker whose first answer is still out, or that answer opens it after.
    if (event.key === "Escape") {
      event.preventDefault();
      setShut(found.start);
      shutPicker();
      return;
    }
    if (!open()) return;
    const list = { choices: choices(), highlight: highlight(), setHighlight, choose };
    if (choiceKeys(event, list)) return;
    // In the words, Tab picks too, as Enter does.
    const choice = choices()[highlight()];
    if (event.key === "Tab" && choice) {
      event.preventDefault();
      choose(choice);
    }
  }

  const optionId = (index: number) => `link-choice-${index}`;

  return (
    <div class="composer-area">
      <Show when={open() && query()}>
        {(found) => (
          <ChoiceList
            id="link-picker"
            label={found().kind === "mention" ? "Persons" : "Tasks and Projects"}
            choices={choices()}
            highlight={highlight()}
            optionId={optionId}
            onChoose={choose}
          />
        )}
      </Show>
      <form
        class="composer"
        data-testid="composer"
        data-folded={folded() ? "" : undefined}
        onFocusIn={() => setFocused(true)}
        onFocusOut={(event) => {
          const form = event.currentTarget;
          afterPress(() => setFocused(form.contains(document.activeElement)));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void record();
        }}
      >
        {/* Colour never carries the Context alone: the composer names it. */}
        <label for={JOURNAL_COMPOSER} class="composer-label">
          <span class="composer-label-words">
            {props.contextName ? `Record an Entry in ${props.contextName}` : "Record an Entry"}
          </span>
          <ComposerKey shown={folded()} letter="r" />
        </label>
        <Show when={props.followingUp}>
          {(earlier) => (
            <p class="composer-follow-up">
              <span>Following up “{earlier().summary}”</span>
              <button type="button" class="quiet" onClick={() => props.onStopFollowingUp()}>
                Not a Follow-up
              </button>
            </p>
          )}
        </Show>
        <div class="composer-row">
          <textarea
            ref={field}
            id={JOURNAL_COMPOSER}
            rows={2}
            aria-keyshortcuts="r"
            value={words()}
            aria-autocomplete="list"
            aria-controls={open() ? "link-picker" : undefined}
            aria-activedescendant={open() && highlight() >= 0 ? optionId(highlight()) : undefined}
            onInput={(event) => {
              changeWords(event.currentTarget.value);
              look();
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) look();
            }}
            onClick={look}
            onBlur={shutPicker}
          />
          <button type="submit" class="record-button" disabled={!canRecord()}>
            <Check size={16} aria-hidden="true" />
            Record
          </button>
        </div>
      </form>
    </div>
  );
}
