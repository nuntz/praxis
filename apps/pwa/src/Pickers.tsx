import type { End, NewLink, Person, Project, Task } from "@praxis/domain";
import { createSignal, createUniqueId, For, onMount, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { personsHeld, referencesHeld } from "./offline-copy.ts";
import { type CallTool, Unreachable, unreachableMessage } from "./tools.ts";

/**
 * The pickers of the Context's records: the composer's, which `@` and `#` open in the words, and
 * the search chips', which open from a chip (section 8.4). Each is one list of choices read the
 * same way, so a Person or a Project is picked alike wherever it is picked.
 */

/** One choice in a picker: a record there is, or a new one made from what was typed. */
export type Choice = { name: string; detail: string | null; to: NewLink["to"] };

/** How many records a picker offers at once. Typing more narrows them. */
export const OFFERED = 8;

/**
 * What a picker offers for what was typed: the records whose names hold it, and whether they are
 * what the Offline Copy holds, read with no network; or what stopped them being read.
 */
export type Offered = { choices: Choice[]; held: boolean } | { problem: string };

/**
 * The Persons whose names hold what was typed, as `@` offers them, each told apart from another
 * with the same name by the latest Entry that Mentions them.
 */
export async function personsOffered(
  callTool: CallTool,
  context: string,
  typed: string,
  timeZone: string,
): Promise<Offered> {
  try {
    const persons = await callTool("list_persons", named(typed));
    if (!persons.ok) return { problem: persons.error.message };
    return {
      choices: personChoices(persons.value.items, timeZone).slice(0, OFFERED),
      held: false,
    };
  } catch (error) {
    if (!(error instanceof Unreachable)) return { problem: unreachableMessage(error) };
    return {
      choices: personChoices(personsHeld(context, typed), timeZone).slice(0, OFFERED),
      held: true,
    };
  }
}

/**
 * The Projects whose names hold what was typed, and the Tasks too for `#`, which References
 * either. A Finished or Dropped Project is offered with the open ones, marked as such: `#` says
 * each choice's kind beside it, and a picker of Projects alone only how a closed one ended.
 */
export async function referencesOffered(
  callTool: CallTool,
  context: string,
  typed: string,
  which: "projects" | "tasks and projects",
): Promise<Offered> {
  const withTasks = which === "tasks and projects";
  const choices = (projects: Project[], tasks: Task[]) =>
    [
      ...projects.map((project) => projectChoice(project, withTasks)),
      ...tasks.map(taskChoice),
    ].slice(0, OFFERED);
  try {
    const [projects, tasks] = await Promise.all([
      callTool("list_projects", named(typed)),
      withTasks ? callTool("list_tasks", named(typed)) : null,
    ]);
    if (!projects.ok) return { problem: projects.error.message };
    if (tasks && !tasks.ok) return { problem: tasks.error.message };
    return { choices: choices(projects.value.items, tasks?.value.items ?? []), held: false };
  } catch (error) {
    if (!(error instanceof Unreachable)) return { problem: unreachableMessage(error) };
    const held = referencesHeld(context, typed);
    return { choices: choices(held.projects, withTasks ? held.tasks : []), held: true };
  }
}

function named(typed: string): { named?: string } {
  return typed === "" ? {} : { named: typed };
}

/**
 * The keys that move through a picker's choices and pick one, from the field that has the focus:
 * the arrows move the highlight and Enter picks it. True when the key was the picker's.
 */
export function choiceKeys(
  event: KeyboardEvent,
  list: {
    choices: Choice[];
    highlight: number;
    setHighlight: (at: number) => void;
    choose: (choice: Choice) => void;
  },
): boolean {
  const last = list.choices.length - 1;
  if (event.key === "ArrowDown") list.setHighlight(Math.min(list.highlight + 1, last));
  else if (event.key === "ArrowUp") list.setHighlight(Math.max(list.highlight - 1, 0));
  else if (event.key === "Enter" && list.highlight >= 0) {
    const choice = list.choices[list.highlight];
    if (choice) list.choose(choice);
  } else return false;
  event.preventDefault();
  return true;
}

/**
 * A picker's list of choices. The focus stays in the field typed into, and the highlighted choice
 * is told by its `aria-activedescendant`, each choice's id being `optionId` of its place.
 */
export function ChoiceList(props: {
  id: string;
  /** What it lists: "Persons", "Tasks and Projects". */
  label: string;
  choices: Choice[];
  highlight: number;
  optionId: (index: number) => string;
  onChoose: (choice: Choice) => void;
}) {
  return (
    <div id={props.id} class="link-picker" role="listbox" aria-label={props.label}>
      <For each={props.choices}>
        {(choice, index) => (
          <div
            id={props.optionId(index())}
            role="option"
            tabIndex={-1}
            aria-selected={props.highlight === index()}
            classList={{ highlighted: props.highlight === index() }}
            // Keep the focus in the field, so a pick in the words lands where the caret was.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onChoose(choice)}
            // The keys are the field's own (choiceKeys), but an option given focus picks too.
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onChoose(choice);
            }}
          >
            <ChoiceLabel choice={choice} />
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * A picker opened from a control rather than from the words, as a search chip opens one: a field
 * that narrows the choices as it is typed in, over the list of them. It offers what `offer` reads
 * for what is typed, and nothing typed yet offers the first of them. It never makes a record.
 */
export function ChoicePicker(props: {
  /** What it lists, as the list is named: "Projects". */
  label: string;
  /** The field's name: "Find a Project". */
  fieldLabel: string;
  /** What is said when nothing it lists holds what was typed. */
  none: string;
  offer: (typed: string) => Promise<Offered>;
  onPick: (choice: Choice) => void;
}) {
  const id = createUniqueId();
  const [typed, setTyped] = createSignal("");
  const [choices, setChoices] = createSignal<Choice[] | null>(null);
  const [highlight, setHighlight] = createSignal(-1);
  const [problem, setProblem] = createSignal<string | null>(null);

  // Each change to what is typed asks afresh. Only the answer to the latest is shown.
  const { read: offer } = latestRead(async (current, asked: string) => {
    const offered = await props.offer(asked.trim());
    if (!current()) return;
    if ("problem" in offered) return setProblem(offered.problem);
    setProblem(null);
    setChoices(offered.choices);
    setHighlight(offered.choices.length > 0 ? 0 : -1);
  });
  onMount(() => void offer(""));

  const optionId = (index: number) => `${id}-choice-${index}`;
  const shown = () => choices() ?? [];
  return (
    <div class="choice-picker">
      <input
        type="text"
        class="choice-field"
        role="combobox"
        aria-label={props.fieldLabel}
        aria-autocomplete="list"
        aria-expanded={shown().length > 0}
        aria-controls={`${id}-choices`}
        aria-activedescendant={highlight() >= 0 ? optionId(highlight()) : undefined}
        autocomplete="off"
        value={typed()}
        onInput={(event) => {
          setTyped(event.currentTarget.value);
          void offer(event.currentTarget.value);
        }}
        onKeyDown={(event) =>
          choiceKeys(event, {
            choices: shown(),
            highlight: highlight(),
            setHighlight,
            choose: props.onPick,
          })
        }
      />
      <ChoiceList
        id={`${id}-choices`}
        label={props.label}
        choices={shown()}
        highlight={highlight()}
        optionId={optionId}
        onChoose={props.onPick}
      />
      <Show when={choices()?.length === 0}>
        <p class="choice-none">{props.none}</p>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
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
function personChoices(persons: Person[], timeZone: string): Choice[] {
  const named = Map.groupBy(persons, (person) => person.name);
  return persons.map((person) => ({
    name: person.name,
    detail: (named.get(person.name)?.length ?? 0) > 1 ? latestMention(person, timeZone) : null,
    to: { kind: "person", id: person.id },
  }));
}

function latestMention(person: Person, timeZone: string): string {
  const latest = person.latest_mention;
  if (!latest) return "never Mentioned";
  const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone });
  return `last in “${latest.summary}”, ${day.format(new Date(latest.at))}`;
}

/** Each end as the screen names it. */
const END: Record<End, string> = { finished: "Finished", dropped: "Dropped" };

/** A Project offered, saying it is one when other kinds are offered beside it. */
function projectChoice(project: Project, kindSaid: boolean): Choice {
  const ended = project.state.is === "open" ? null : END[project.state.is];
  const detail = kindSaid ? (ended ? `Project, ${ended}` : "Project") : ended;
  return { name: project.name, detail, to: { kind: "project", id: project.id } };
}

function taskChoice(task: Task): Choice {
  const state = task.state.is === "open" ? "Task" : `Task, ${END[task.state.is]}`;
  return { name: task.title, detail: state, to: { kind: "task", id: task.id } };
}
