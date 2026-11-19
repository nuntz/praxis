import {
  type Anchor,
  type End,
  type Entry,
  type EntryNamed,
  followEdit,
  inlineTasks,
  type LinkQuery,
  linkQueryAt,
  type NewLink,
  type Person,
  type Project,
  pickLink,
  type Task,
} from "@praxis/domain";
import { createSignal, For, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { unreachableMessage, useCallTool } from "./tools.ts";

/** A link picked in the draft, followed through what is typed after it. */
type Pick = { to: NewLink["to"]; anchor: Anchor };

/** One choice in a picker: a record there is, or a new one made from what was typed. */
type Choice = { name: string; detail: string | null; to: NewLink["to"] };

/** How many records a picker offers at once. Typing more narrows them. */
const OFFERED = 8;

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The Journal's composer, which records an Entry with no model turn. `@` opens a picker of the
 * Context's Persons and `#` one of its Tasks and Projects. Only a pick makes a link: the editor
 * keeps each beside the words and passes them to `record_entry`, and never matches a name to a
 * record. The Entry it records may be a Follow-up to one the person chose.
 */
export function Composer(props: {
  /** The Context the Entry is recorded in, named on the composer once known. */
  contextName: string | undefined;
  /** The earlier Entry the one recorded continues or corrects, if the person chose one. */
  followingUp: EntryNamed | null;
  onStopFollowingUp: () => void;
  onRecorded: (entry: Entry) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  let field!: HTMLTextAreaElement;
  const [words, setWords] = createSignal("");
  const [picks, setPicks] = createSignal<Pick[]>([]);
  const [query, setQuery] = createSignal<LinkQuery | null>(null);
  // Where the picker the person shut with Escape starts, so it stays shut as they type on.
  const [shut, setShut] = createSignal<number | null>(null);
  const [choices, setChoices] = createSignal<Choice[]>([]);
  // The choice Enter or Tab picks. None at first when only a new record is offered, so `@ali`
  // and Enter is text and a new line.
  const [highlight, setHighlight] = createSignal(-1);
  const [sending, setSending] = createSignal(false);
  const canRecord = () => !sending() && words().trim() !== "";
  const open = () => query() !== null && choices().length > 0;

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
    const named = typed === "" ? {} : { named: typed };
    try {
      let records: Choice[];
      if (found.kind === "mention") {
        const persons = await callTool("list_persons", named);
        if (!persons.ok) return props.onProblem(persons.error.message);
        records = personChoices(persons.value.items).slice(0, OFFERED);
      } else {
        const [projects, tasks] = await Promise.all([
          callTool("list_projects", named),
          callTool("list_tasks", named),
        ]);
        if (!projects.ok) return props.onProblem(projects.error.message);
        if (!tasks.ok) return props.onProblem(tasks.error.message);
        records = [
          ...projects.value.items.map(projectChoice),
          ...tasks.value.items.map(taskChoice),
        ].slice(0, OFFERED);
      }
      // Shut meanwhile, by Escape or by leaving the words, the query is no longer asked: its
      // answer would show for the next query until that one's own answer lands.
      if (!current() || query() !== found) return;
      const made: Choice[] =
        typed === ""
          ? []
          : [
              found.kind === "mention"
                ? { name: typed, detail: null, to: { kind: "new_person", name: typed } }
                : { name: typed, detail: null, to: { kind: "new_project", name: typed } },
            ];
      setChoices([...records, ...made]);
      setHighlight(records.length > 0 ? 0 : -1);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    }
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
      const result = await callTool("record_entry", {
        words: words(),
        tasks: inlineTasks(words()),
        links: picks(),
        ...(props.followingUp ? { follow_up_to: props.followingUp.id } : {}),
      });
      if (!result.ok) return props.onProblem(result.error.message);
      props.onRecorded(result.value.record);
      setWords("");
      setPicks([]);
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
    const last = choices().length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((at) => Math.min(at + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((at) => Math.max(at - 1, 0));
    } else if ((event.key === "Enter" || event.key === "Tab") && highlight() >= 0) {
      event.preventDefault();
      const choice = choices()[highlight()];
      if (choice) choose(choice);
    }
  }

  const optionId = (index: number) => `link-choice-${index}`;

  return (
    <div class="composer-area">
      <Show when={open() && query()}>
        {(found) => (
          <div
            id="link-picker"
            class="link-picker"
            role="listbox"
            aria-label={found().kind === "mention" ? "Persons" : "Tasks and Projects"}
          >
            <For each={choices()}>
              {(choice, index) => (
                <div
                  id={optionId(index())}
                  role="option"
                  // Focus stays in the words; the highlight is told by aria-activedescendant.
                  tabIndex={-1}
                  aria-selected={highlight() === index()}
                  classList={{ highlighted: highlight() === index() }}
                  // Keep the caret in the words, so the pick lands where it was.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(choice)}
                  // The keys are the words' own (see onKeyDown), but an option given focus picks too.
                  onKeyDown={(event) => {
                    if (event.key === "Enter") choose(choice);
                  }}
                >
                  <ChoiceLabel choice={choice} />
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <form
        class="composer"
        data-testid="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void record();
        }}
      >
        {/* Colour never carries the Context alone: the composer names it. */}
        <label for="new-entry" class="composer-label">
          {props.contextName ? `Record an Entry in ${props.contextName}` : "Record an Entry"}
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
            id="new-entry"
            rows={2}
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
          <button type="submit" disabled={!canRecord()}>
            Record
          </button>
        </div>
      </form>
    </div>
  );
}

function ChoiceLabel(props: { choice: Choice }) {
  const { to, name, detail } = props.choice;
  if (to.kind === "new_person") return <>New Person “{name}”</>;
  if (to.kind === "new_project") return <>New Project “{name}”</>;
  return (
    <>
      <span class="choice-name">{name}</span>
      <Show when={detail}>{(said) => <span class="choice-detail"> · {said()}</span>}</Show>
    </>
  );
}

/**
 * The Persons offered, each told apart from another with the same name by the latest Entry that
 * Mentions them. The picker never takes two such Persons to be one.
 */
function personChoices(persons: Person[]): Choice[] {
  const named = Map.groupBy(persons, (person) => person.name);
  return persons.map((person) => ({
    name: person.name,
    detail: (named.get(person.name)?.length ?? 0) > 1 ? latestMention(person) : null,
    to: { kind: "person", id: person.id },
  }));
}

function latestMention(person: Person): string {
  const latest = person.latest_mention;
  if (!latest) return "never Mentioned";
  return `last in “${latest.summary}”, ${dayFormat.format(new Date(latest.at))}`;
}

/** Each end as the screen names it. */
const END: Record<End, string> = { finished: "Finished", dropped: "Dropped" };

function projectChoice(project: Project): Choice {
  const state = project.state.is === "open" ? "Project" : `Project, ${END[project.state.is]}`;
  return { name: project.name, detail: state, to: { kind: "project", id: project.id } };
}

function taskChoice(task: Task): Choice {
  const state = task.state.is === "open" ? "Task" : `Task, ${END[task.state.is]}`;
  return { name: task.title, detail: state, to: { kind: "task", id: task.id } };
}
