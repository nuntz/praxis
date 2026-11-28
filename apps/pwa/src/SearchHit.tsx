import type { Excerpt, ProjectState, SearchHit, Task } from "@praxis/domain";
import Check from "lucide-solid/icons/check";
import { For, Index, Show } from "solid-js";
import { authorName } from "./authors.ts";
import { recordAnchor } from "./Journal.tsx";
import { createFinishing, DueMark, TaskMarks } from "./TaskItem.tsx";

/** What each kind of record a search finds is called. */
const KIND: Record<SearchHit["kind"], string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
};

/** What a Project found says of where it stands. */
const PROJECT_STATE: Record<ProjectState["is"], string> = {
  open: "Open",
  finished: "Finished",
  dropped: "Dropped",
};

/** Where a record found is shown in the Journal: the Entry to read it on, and its anchor there. */
export type JournalPlace = { entry: string; anchor: string };

/** A Project or a Person found, which the search can be narrowed to. */
export type NarrowsTo = Extract<SearchHit, { kind: "project" | "person" }>;

/** What a record found does once tapped, and what it is shown with. */
export type HitActions = {
  /** The Context's time zone, in which a Task's and a Project's marks tell their days. */
  timeZone: string;
  /** When a record found was made, as the Journal's days say it, in the Context's zone. */
  formatTime: (at: string) => string;
  /** Bring an Entry, or a Task on the Entry it hangs off, into view in the Journal. */
  onShow: (place: JournalPlace) => void;
  /** Narrow the search to a Project or a Person found. */
  onNarrowTo: (hit: NarrowsTo) => void;
  /**
   * A Task's round control was pressed: where the answer to its write goes, placed only while no
   * read since shows the Task as it now is.
   */
  answering: () => (task: Task) => void;
  onProblem: (message: string) => void;
};

/**
 * One record found, its excerpt and when it was made in the order shown: an Entry's time over
 * its words, a Task's, a Project's and a Person's under its title, after its kind for a screen
 * reader. Its name is its kind, its time and its excerpt, and every word it shows. An Entry is a
 * link that brings it into view in the Journal; a Person narrows the search to them, so a
 * Person, who has no place of their own on the screen, leads to everything about them.
 */
export function Hit(props: { hit: SearchHit; actions: HitActions }) {
  const hit = props.hit;
  if (hit.kind === "task") return <TaskFound hit={hit} actions={props.actions} />;
  if (hit.kind === "project") return <ProjectFound hit={hit} actions={props.actions} />;
  const kind = <span class="visually-hidden">{KIND[hit.kind]}, </span>;
  if (hit.kind === "person") {
    return (
      <li class="search-hit search-person" data-testid="search-hit">
        <button type="button" class="search-hit-body" onClick={() => props.actions.onNarrowTo(hit)}>
          {kind}
          <ExcerptShown excerpt={hit.excerpt} />
          <Made hit={hit} actions={props.actions} />
        </button>
      </li>
    );
  }
  const place = { entry: hit.id, anchor: recordAnchor("entry", hit.id) };
  return (
    <li class="search-hit search-entry" data-testid="search-hit">
      <a
        class="search-hit-body"
        href={`#${place.anchor}`}
        onClick={(event) => {
          event.preventDefault();
          props.actions.onShow(place);
        }}
      >
        {kind}
        <Made hit={hit} actions={props.actions} />
        <ExcerptShown excerpt={hit.excerpt} />
      </a>
    </li>
  );
}

/** When a record found was made, and by whom when that is not the person. */
function Made(props: { hit: SearchHit; actions: HitActions }) {
  return (
    <span class="search-made">
      <time datetime={props.hit.at}>{props.actions.formatTime(props.hit.at)}</time>
      <Show when={authorShown(props.hit)}>{(author) => ` · ${author()}`}</Show>
    </span>
  );
}

/**
 * A Task found: its round control, which finishes it or reopens a finished one as Attention's
 * does (section 8.3), and beside it a link that brings it into view in the Journal, named by its
 * kind, its title, its time and its marks. Its title alone never finishes it.
 */
function TaskFound(props: { hit: Extract<SearchHit, { kind: "task" }>; actions: HitActions }) {
  const hit = props.hit;
  // Where the answer to the write the round control sent goes, given as it is pressed.
  let answered = (_task: Task) => {};
  const finishing = createFinishing({
    task: () => ({
      id: hit.id,
      title: hit.summary,
      state: hit.state,
      recurrence: hit.recurrence,
      due_date: hit.due_date,
    }),
    onTask: (task) => answered(task),
    onProblem: props.actions.onProblem,
  });
  const place = { entry: hit.origin_entry, anchor: recordAnchor("task", hit.id) };
  return (
    <li
      class="search-hit search-task"
      classList={{ closed: finishing.closed(), finished: finishing.shownFinished() }}
      data-testid="search-hit"
    >
      <div class="search-hit-body">
        <button
          type="button"
          class="search-tick"
          aria-label={`${finishing.shownFinished() ? "Reopen" : "Finish"} “${hit.summary}”`}
          // Only said to be disabled while its answer is awaited, so it keeps the focus.
          aria-disabled={finishing.sending()}
          disabled={finishing.dropped()}
          onClick={() => {
            if (finishing.sending()) return;
            answered = props.actions.answering();
            void finishing.setFinished(!finishing.shownFinished());
          }}
        >
          <span class="search-tick-circle">
            <Show when={finishing.shownFinished()}>
              <Check size={14} stroke-width={3} aria-hidden="true" />
            </Show>
          </span>
        </button>
        <a
          class="search-task-link"
          href={`#${place.anchor}`}
          onClick={(event) => {
            event.preventDefault();
            props.actions.onShow(place);
          }}
        >
          <span class="visually-hidden">{KIND.task}, </span>
          <ExcerptShown excerpt={hit.excerpt} />
          <span class="search-hit-meta">
            <Made hit={hit} actions={props.actions} />
            <TaskMarks
              task={hit}
              timeZone={props.actions.timeZone}
              mark={
                <Show when={hit.state.is === "finished"}>
                  <span class="task-mark">Finished</span>
                </Show>
              }
            />
          </span>
        </a>
      </div>
    </li>
  );
}

/**
 * A Project found: whether it is open or at an end, and while open, its count of actionable Tasks,
 * its Due Date and Attention's flag when it has no open Task. It shows no time, but is named by it.
 */
function ProjectFound(props: {
  hit: Extract<SearchHit, { kind: "project" }>;
  actions: HitActions;
}) {
  const hit = props.hit;
  const open = () => (hit.state.is === "open" ? hit.state : null);
  return (
    // A Project found narrows the search to it, so a closed one, which Attention never opens,
    // leads to everything in it too.
    <li class="search-hit search-project" data-testid="search-hit">
      <button type="button" class="search-hit-body" onClick={() => props.actions.onNarrowTo(hit)}>
        <span class="visually-hidden">{KIND.project}, </span>
        <ExcerptShown excerpt={hit.excerpt} />
        <span class="search-hit-meta">
          {/* Heard before its marks, as a Task's time is, and not drawn. */}
          <span class="visually-hidden">
            <Made hit={hit} actions={props.actions} /> ·{" "}
          </span>
          <span class="task-mark">{PROJECT_STATE[hit.state.is]}</span>
          <Show when={open()}>
            {(state) => (
              <>
                <span class="task-mark">{hit.actionable_tasks} actionable</span>
                <Show when={hit.due_date}>
                  {(due) => (
                    <DueMark
                      due={due()}
                      overdue={state().overdue !== null}
                      timeZone={props.actions.timeZone}
                    />
                  )}
                </Show>
                <Show when={hit.no_open_task}>
                  <span class="task-mark flag">Needs a next Task or finishing</span>
                </Show>
              </>
            )}
          </Show>
        </span>
      </button>
    </li>
  );
}

/** Who made a record found, as the screen names them, when it is not the person. */
function authorShown(hit: SearchHit): string | null {
  if (hit.kind !== "entry" && hit.kind !== "task") return null;
  return hit.author.kind === "person" ? null : authorName(hit.author);
}

/** An excerpt as typed, with what matched marked: never rendered as Markdown (section 8.4). */
function ExcerptShown(props: { excerpt: Excerpt }) {
  const parts = () => {
    const { text, matches } = props.excerpt;
    const cut: { text: string; matched: boolean }[] = [];
    let from = 0;
    for (const { start, end } of matches) {
      if (start > from) cut.push({ text: text.slice(from, start), matched: false });
      cut.push({ text: text.slice(start, end), matched: true });
      from = end;
    }
    if (from < text.length) cut.push({ text: text.slice(from), matched: false });
    return cut;
  };
  return (
    // Typed by the person, it takes its own direction, as an Arabic sentence ends at its left: taken
    // anew as its words change, since a browser keeps the direction it first found.
    <For each={[props.excerpt.text]}>
      {() => (
        <span class="search-excerpt" data-testid="search-excerpt" dir="auto">
          {/* Each part follows its place as the excerpt changes, from first words to marked words. */}
          <Index each={parts()}>
            {(part) => (
              <Show when={part().matched} fallback={part().text}>
                <mark>{part().text}</mark>
              </Show>
            )}
          </Index>
        </span>
      )}
    </For>
  );
}
