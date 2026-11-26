import type {
  Day,
  Entry,
  NewRecurrence,
  Project,
  Task,
  TaskDates,
  ToolInput,
  ToolName,
  ToolOutput,
  ToolResult,
  WaitTarget,
} from "@praxis/domain";
import { waitedOnName } from "@praxis/domain";
import { imageLoadingIn } from "@praxis/domain/markdown";
import type { LucideIcon } from "lucide-solid";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import Ban from "lucide-solid/icons/ban";
import Calendar from "lucide-solid/icons/calendar";
import Check from "lucide-solid/icons/check";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Clock from "lucide-solid/icons/clock";
import Folder from "lucide-solid/icons/folder";
import FolderMinus from "lucide-solid/icons/folder-minus";
import FolderPlus from "lucide-solid/icons/folder-plus";
import Hourglass from "lucide-solid/icons/hourglass";
import Repeat from "lucide-solid/icons/repeat";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Trash from "lucide-solid/icons/trash";
import Undo from "lucide-solid/icons/undo-2";
import UserRound from "lucide-solid/icons/user-round";
import X from "lucide-solid/icons/x";
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { TaskRow } from "./AttentionRows.tsx";
import { todayIn } from "./days.tsx";
import { latestRead } from "./latest-read.ts";
import { MoveRecord } from "./Move.tsx";
import { ChoicePicker, personsOffered, referencesOffered, waitTargetsOffered } from "./Pickers.tsx";
import { recurrencesOffered, recurrenceWords, sameRule } from "./recurrence-words.ts";
import { createFinishing, DueMark, TaskMarks } from "./TaskItem.tsx";
import {
  type CallTool,
  Unreachable,
  unreachableMessage,
  useCallTool,
  useContextId,
} from "./tools.ts";
import { Words } from "./Words.tsx";

/**
 * A Task's or a Project's page, opened from its row in Attention over the whole column (section
 * 8.3): everything it has, each changed from here, and its ends. A choice opens as a page of its
 * own on top; back returns to the page under it. The column is left as it was underneath.
 */

/** One page of the panel: a Task's or a Project's own, or a choice made for the one under it. */
export type Page =
  | { kind: "task"; id: string; held?: Task }
  | { kind: "project"; id: string; held?: Project }
  | { kind: "recurrence" | "delegate" | "wait" | "place"; task: string }
  | { kind: "move"; project: string };

/** What a change said in Attention's status line, and how to undo it, where it can be. */
export type Said = {
  text: string;
  /** Undoes the change: null once it is undone, or why it was refused. */
  undo?: { label: string; run: (callTool: CallTool) => Promise<string | null> };
};

const CHOICE_TITLES = {
  recurrence: "Recurrence",
  delegate: "Delegated to",
  wait: "Waits on",
  place: "Project",
  move: "Move to another Context",
} as const;

export function Inspector(props: {
  pages: Page[];
  setPages: (pages: Page[]) => void;
  timeZone: string;
  /** An open Project's name, as Attention's view holds it. */
  projectName: (id: string) => string | undefined;
  /** Attention's view as last read: the page is read again each time it is, to show the same. */
  viewRead: () => unknown;
  /** A change was made: Attention reads its view again. */
  onChanged: () => void;
  onSaid: (said: Said) => void;
  /** The panel closed: the focus goes back to the row it was opened from. */
  onClosed: () => void;
}) {
  const callTool = useCallTool();
  const contextId = useContextId();
  // The record the first page was opened with, as its row held it, until it is read afresh.
  const opening = props.pages[0];
  const [task, setTask] = createSignal<Task | null>(
    opening?.kind === "task" ? (opening.held ?? null) : null,
  );
  const [project, setProject] = createSignal<Project | null>(
    opening?.kind === "project" ? (opening.held ?? null) : null,
  );
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  // A page pushed comes in from the side; one returned to by back is simply there.
  const [pushed, setPushed] = createSignal(true);
  let panel: HTMLDivElement | undefined;

  const top = () => props.pages[props.pages.length - 1];
  /** The Task or Project the page on top is of, or is a choice for. */
  const subject = (): { kind: "task" | "project"; id: string } | null => {
    const page = top();
    if (!page) return null;
    if (page.kind === "task" || page.kind === "project") return page;
    if (page.kind === "move") return { kind: "project", id: page.project };
    return { kind: "task", id: page.task };
  };
  const shownTask = () => {
    const shown = task();
    return subject()?.kind === "task" && shown?.id === subject()?.id ? shown : null;
  };
  const shownProject = () => {
    const shown = project();
    return subject()?.kind === "project" && shown?.id === subject()?.id ? shown : null;
  };

  const { read, changed } = latestRead(async (current) => {
    const of = untrack(subject);
    if (!of) return;
    // With no network the page shows the record as Attention holds it, from the Offline Copy
    // where there is one, and says nothing until a write needs the network (section 8.8).
    const held = () => (of.kind === "task" ? shownTask() : shownProject()) !== null;
    try {
      if (of.kind === "task") {
        const result = await callTool("get_task", { id: of.id });
        if (!current()) return;
        if (!result.ok) return setProblem(result.error.message);
        setTask(result.value);
      } else {
        const result = await callTool("get_project", { id: of.id });
        if (!current()) return;
        if (!result.ok) return setProblem(result.error.message);
        setProject(result.value);
      }
    } catch (error) {
      if (current() && !(error instanceof Unreachable && untrack(held))) {
        setProblem(unreachableMessage(error));
      }
    }
  });
  // Read on opening a page, and again whenever Attention's view is: a change made here or
  // elsewhere moves both.
  createEffect(
    on([() => JSON.stringify(subject()), props.viewRead], () => {
      void read();
    }),
  );

  // While a write is out, the page stays as it was when the write was sent: nothing goes back or
  // opens, and no other write starts, so its answer lands on the page it was made from.
  function push(page: Page) {
    if (sending()) return;
    if (page.kind === "task" && page.held) setTask(page.held);
    if (page.kind === "project" && page.held) setProject(page.held);
    setProblem(null);
    setPushed(true);
    props.setPages([...props.pages, page]);
    queueMicrotask(focusPage);
  }

  function back() {
    if (sending() || props.pages.length === 0) return;
    setProblem(null);
    const left = top();
    const rest = props.pages.slice(0, -1);
    setPushed(false);
    props.setPages(rest);
    if (rest.length === 0) return props.onClosed();
    // The focus goes back to the line that opened the choice, or to the page's start.
    queueMicrotask(() => {
      const line = left && panel?.querySelector<HTMLElement>(`[data-page="${left.kind}"]`);
      (line ?? panel?.querySelector<HTMLElement>(".inspector-back"))?.focus();
    });
  }

  /** Leave the page of what has left Attention, or the panel when it was the first. */
  function leave() {
    const at = props.pages.findIndex(
      (page) => (page.kind === "task" || page.kind === "project") && page.id === subject()?.id,
    );
    const rest = props.pages.slice(0, Math.max(at, 0));
    setPushed(false);
    props.setPages(rest);
    if (rest.length === 0) props.onClosed();
    else queueMicrotask(focusPage);
  }

  function focusPage() {
    // The page's own field first, then the header's Back: one query for all three would find the
    // first in the page's order, which is the header's.
    const first =
      panel?.querySelector<HTMLElement>(
        ".inspector-page .choice-field, .inspector-page button.inspector-choice",
      ) ?? panel?.querySelector<HTMLElement>(".inspector-back");
    first?.focus();
  }

  /**
   * A write from the panel: its answer, or null once its problem is shown. One whose answer moves
   * the page (`holds`) holds it while it is out, so nothing else goes back, opens or is sent. One
   * that only changes what the page shows, a title or a date, holds nothing: it is sent as its
   * field is left, and the press that left it must land as it was meant.
   */
  async function write<N extends ToolName>(
    tool: N,
    input: ToolInput<N>,
    { holds = true } = {},
  ): Promise<ToolOutput[N] | null> {
    if (sending()) return null;
    if (holds) setSending(true);
    setProblem(null);
    changed();
    try {
      // A Context tool's input and output are its own, whatever the caller also reaches.
      const call = callTool as unknown as (
        tool: N,
        input: ToolInput<N>,
      ) => Promise<ToolResult<ToolOutput[N]>>;
      const result = await call(tool, input);
      if (!result.ok) {
        setProblem(result.error.message);
        return null;
      }
      props.onChanged();
      return result.value;
    } catch (error) {
      setProblem(unreachableMessage(error));
      return null;
    } finally {
      if (holds) setSending(false);
    }
  }

  /** A Task as an answer gave it, shown only while its own page is the one shown. */
  function placeTask(answered: Task) {
    const of = subject();
    if (of?.kind === "task" && of.id === answered.id) setTask(answered);
  }

  function placeProject(answered: Project) {
    const of = subject();
    if (of?.kind === "project" && of.id === answered.id) setProject(answered);
  }

  async function writeTask<N extends ToolName>(
    tool: N,
    input: ToolInput<N>,
    options?: { holds: boolean },
  ): Promise<Task | null> {
    const answer = (await write(tool, input, options)) as { record: Task } | null;
    if (answer) placeTask(answer.record);
    return answer?.record ?? null;
  }

  async function writeProject<N extends ToolName>(
    tool: N,
    input: ToolInput<N>,
    options?: { holds: boolean },
  ): Promise<Project | null> {
    const answer = (await write(tool, input, options)) as { record: Project } | null;
    if (answer) placeProject(answer.record);
    return answer?.record ?? null;
  }

  // Each Task's actions.

  /** A title or name as typed, sent unless it is empty or what the record has already. */
  async function rename(typed: string, kind: "task" | "project") {
    const now = typed.replace(/\s+/g, " ").trim();
    const id = subject()?.id;
    const was = kind === "task" ? shownTask()?.title : shownProject()?.name;
    if (!id || now === "" || now === was) return;
    if (kind === "task") await writeTask("rename_task", { id, title: now }, { holds: false });
    else await writeProject("rename_project", { id, name: now }, { holds: false });
  }

  async function setDate(field: keyof TaskDates, day: string) {
    const shown = shownTask();
    if (!shown) return;
    await writeTask(
      "set_task_dates",
      { id: shown.id, [field]: day === "" ? null : day },
      { holds: false },
    );
  }

  async function setRecurrence(rule: NewRecurrence | null) {
    const shown = shownTask();
    if (!shown) return;
    const written =
      rule === null
        ? await writeTask("remove_recurrence", { id: shown.id })
        : await writeTask("set_recurrence", { id: shown.id, recurrence: rule });
    if (written) back();
  }

  async function delegate(personId: string | null) {
    const shown = shownTask();
    if (!shown) return;
    const written =
      personId === null
        ? await writeTask("take_back_task", { id: shown.id })
        : await writeTask("delegate_task", { id: shown.id, person_id: personId });
    if (written) back();
  }

  async function waitOn(on: WaitTarget, name: string) {
    const shown = shownTask();
    if (!shown) return;
    const written = await writeTask("wait_on", { id: shown.id, on });
    if (!written) return;
    // A Task left Waiting and not due leaves Attention until the wait ends (section 8.3).
    const due = written.due_date !== null && written.due_date <= todayIn(props.timeZone);
    if (written.state.is === "open" && written.state.waiting && !due) {
      props.onSaid({
        text: `“${written.title}” waits on “${name}”, and leaves Attention until that ends.`,
      });
    }
    back();
  }

  async function stopWaiting(on: WaitTarget) {
    const shown = shownTask();
    if (!shown) return;
    await writeTask("stop_waiting", { id: shown.id, on }, { holds: false });
  }

  async function place(projectId: string | null) {
    const shown = shownTask();
    if (!shown) return;
    const written = await writeTask("move_task", { id: shown.id, project_id: projectId });
    if (written) back();
  }

  async function makeProject() {
    const shown = shownTask();
    if (!shown) return;
    const made = await writeProject("make_project_from_task", { id: shown.id });
    if (!made) return;
    setPushed(true);
    props.setPages([...props.pages.slice(0, -1), { kind: "project", id: made.id }]);
    setProject(made);
    queueMicrotask(focusPage);
  }

  async function dropTask() {
    const shown = shownTask();
    if (!shown) return;
    const written = await writeTask("drop_task", { id: shown.id });
    if (!written) return;
    props.onSaid({
      text: `Dropped “${written.title}”.`,
      undo: { label: "Reopen", run: (call) => refusal(call("reopen_task", { id: written.id })) },
    });
    leave();
  }

  async function deleteTask() {
    const shown = shownTask();
    if (!shown) return;
    const written = await write("delete_task", { id: shown.id });
    if (!written) return;
    props.onSaid({
      text: `“${shown.title}” is in the Trash.`,
      undo: { label: "Restore", run: (call) => refusal(call("restore", { id: shown.id })) },
    });
    leave();
  }

  /** A finished or dropped Task opened again: it is open, and its page stays. */
  async function reopenTask() {
    const shown = shownTask();
    if (!shown) return;
    await writeTask("reopen_task", { id: shown.id }, { holds: false });
  }

  // Each Project's.

  async function setProjectDue(day: string) {
    const shown = shownProject();
    if (!shown) return;
    await writeProject(
      "set_project_due_date",
      { id: shown.id, due_date: day === "" ? null : day },
      { holds: false },
    );
  }

  async function endProject(end: "finish_project" | "drop_project") {
    const shown = shownProject();
    if (!shown) return;
    const open = openTasks(shown);
    const written = await writeProject(end, { id: shown.id });
    if (!written) return;
    const dropped =
      open === 0 ? "" : ` Its ${open} open ${open === 1 ? "Task was" : "Tasks were"} dropped.`;
    props.onSaid({
      text: `${end === "finish_project" ? "Finished" : "Dropped"} ${written.name}.${dropped}`,
      undo: { label: "Reopen", run: (call) => refusal(call("reopen_project", { id: written.id })) },
    });
    leave();
  }

  /** A finished or dropped Project declared open again; its Tasks dropped with it stay so. */
  async function reopenProject() {
    const shown = shownProject();
    if (!shown) return;
    await writeProject("reopen_project", { id: shown.id }, { holds: false });
  }

  async function deleteProject() {
    const shown = shownProject();
    if (!shown) return;
    const written = await write("delete_project", { id: shown.id });
    if (!written) return;
    props.onSaid({
      text: `${shown.name} is in the Trash. Its Tasks stay, in no Project.`,
      undo: { label: "Restore", run: (call) => refusal(call("restore", { id: shown.id })) },
    });
    leave();
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || sending()) return;
    event.preventDefault();
    event.stopPropagation();
    back();
  };

  onMount(focusPage);
  // A control that answered a change can leave the page with it, and the focus with it: Escape
  // from nowhere still goes back.
  // Escape from nowhere goes back only when the panel is where the person was last, not after a
  // press elsewhere on the screen.
  let lastHere = true;
  const where = (event: Event) => {
    lastHere = event.target instanceof Node && !!panel?.contains(event.target);
  };
  const strayEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || !lastHere) return;
    if (document.activeElement === document.body) onKeyDown(event);
  };
  document.addEventListener("keydown", strayEscape);
  document.addEventListener("pointerdown", where, true);
  document.addEventListener("focusin", where, true);
  onCleanup(() => {
    document.removeEventListener("keydown", strayEscape);
    document.removeEventListener("pointerdown", where, true);
    document.removeEventListener("focusin", where, true);
  });

  const backName = () => {
    const under = props.pages[props.pages.length - 2];
    if (!under) return "Attention";
    if (under.kind === "task") return task()?.id === under.id ? (task()?.title ?? "Task") : "Task";
    if (under.kind === "project")
      return project()?.id === under.id ? (project()?.name ?? "Project") : "Project";
    return "Back";
  };

  return (
    <div
      ref={panel}
      class="inspector"
      role="dialog"
      aria-label={shownTask()?.title ?? shownProject()?.name ?? "Attention"}
      onKeyDown={onKeyDown}
    >
      <header class="inspector-head">
        <button
          type="button"
          class="inspector-back"
          aria-label={`Back to ${backName()}`}
          disabled={sending()}
          onClick={back}
        >
          <ChevronLeft size={20} aria-hidden="true" />
          <span>{backName()}</span>
        </button>
        <Show when={top() && top()?.kind !== "task" && top()?.kind !== "project"}>
          <h3 class="inspector-head-title">
            {CHOICE_TITLES[top()?.kind as keyof typeof CHOICE_TITLES]}
          </h3>
        </Show>
      </header>
      <Show when={top()} keyed>
        {(page) => (
          <div class="inspector-page" classList={{ entering: untrack(pushed) }}>
            <Show when={problem()}>
              {(message) => (
                <p class="problem" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={page.kind === "task" && shownTask()}>
              {(shown) => (
                <TaskPage
                  task={shown()}
                  timeZone={props.timeZone}
                  projectName={props.projectName}
                  sending={sending()}
                  onRename={(typed) => rename(typed, "task")}
                  onDate={(field, day) => void setDate(field, day)}
                  onPush={(kind) => push({ kind, task: shown().id })}
                  onMakeProject={() => void makeProject()}
                  onDrop={() => void dropTask()}
                  onReopen={() => void reopenTask()}
                  onDelete={() => void deleteTask()}
                  onTask={(changedTask) => {
                    placeTask(changedTask);
                    props.onChanged();
                  }}
                  onProblem={setProblem}
                />
              )}
            </Show>
            <Show when={page.kind === "project" && shownProject()}>
              {(shown) => (
                <ProjectPage
                  project={shown()}
                  timeZone={props.timeZone}
                  sending={sending()}
                  onRename={(typed) => rename(typed, "project")}
                  onDue={(day) => void setProjectDue(day)}
                  onMove={() => push({ kind: "move", project: shown().id })}
                  onOpenTask={(opened) => push({ kind: "task", id: opened.id, held: opened })}
                  onEnd={(end) => void endProject(end)}
                  onReopen={() => void reopenProject()}
                  onDelete={() => void deleteProject()}
                  onChanged={props.onChanged}
                  onProblem={setProblem}
                />
              )}
            </Show>
            <Show when={page.kind === "recurrence" && shownTask()}>
              {(shown) => (
                <RecurrencePage
                  task={shown()}
                  sending={sending()}
                  onDate={(day) => void setDate("due_date", day)}
                  onChoose={(rule) => void setRecurrence(rule)}
                />
              )}
            </Show>
            <Show when={page.kind === "delegate" && shownTask()}>
              {(shown) => (
                <>
                  <Show when={shown().state.is === "open" && openState(shown())?.delegated}>
                    {(delegated) => (
                      <ChoiceButton icon={Undo} onClick={() => void delegate(null)}>
                        Take back from {delegated().to.name}
                      </ChoiceButton>
                    )}
                  </Show>
                  <ChoicePicker
                    label="Persons"
                    fieldLabel="Find a Person"
                    placeholder="Find a Person"
                    none="No Person has that name."
                    offer={(typed) => personsOffered(callTool, contextId, typed, props.timeZone)}
                    onPick={(choice) =>
                      void delegate(choice.to.kind === "person" ? choice.to.id : null)
                    }
                  />
                </>
              )}
            </Show>
            <Show when={page.kind === "wait" && shownTask()}>
              {(shown) => (
                <>
                  <For each={openState(shown())?.waiting ?? []}>
                    {({ on }) => (
                      <ChoiceButton
                        icon={X}
                        onClick={() => void stopWaiting({ kind: on.kind, id: on.id })}
                      >
                        Stop waiting on {waitedOnName(on)}
                      </ChoiceButton>
                    )}
                  </For>
                  <ChoicePicker
                    label="Tasks and Projects"
                    fieldLabel="Find a Task or Project to wait on"
                    placeholder="Find a Task or Project to wait on"
                    none="No open Task or Project has that name."
                    offer={(typed) => waitTargetsOffered(callTool, shown().id, typed)}
                    onPick={(choice) => {
                      const to = choice.to;
                      if (to.kind === "task" || to.kind === "project") {
                        void waitOn({ kind: to.kind, id: to.id }, choice.name);
                      }
                    }}
                  />
                </>
              )}
            </Show>
            <Show when={page.kind === "place" && shownTask()}>
              {(shown) => (
                <>
                  <Show when={shown().project}>
                    <ChoiceButton icon={FolderMinus} onClick={() => void place(null)}>
                      Take it out of its Project
                    </ChoiceButton>
                  </Show>
                  <ChoicePicker
                    label="Projects"
                    fieldLabel="Find a Project"
                    placeholder="Find a Project"
                    none="No Project has that name."
                    offer={(typed) => referencesOffered(callTool, contextId, typed, "projects")}
                    onPick={(choice) => {
                      if (choice.to.kind === "project") void place(choice.to.id);
                    }}
                  />
                </>
              )}
            </Show>
            <Show when={page.kind === "move" && shownProject()}>
              {(shown) => (
                <MoveRecord
                  record={{ kind: "project", id: shown().id }}
                  onMoved={(said) => {
                    props.onSaid({ text: said });
                    props.setPages([]);
                    props.onClosed();
                  }}
                  onClose={back}
                />
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

/** A write sent from the status line, whose refusal is thrown to be said there. */
/** A write sent from the status line: null once it is made, or why it was refused. */
async function refusal(
  answer: Promise<{ ok: boolean; error?: { message: string } }>,
): Promise<string | null> {
  const result = await answer;
  return result.ok ? null : (result.error?.message ?? "Praxis refused it.");
}

function openState(task: Task) {
  return task.state.is === "open" ? task.state : null;
}

function openTasks(project: Project): number {
  return project.tasks.filter((task) => task.state.is === "open").length;
}

/**
 * The title, or a Project's name, changed where it is shown: on leaving it or on Enter; Escape
 * puts it back. What is typed is the person's until then: a fresh read of the record shows its
 * title only in a field nothing has been typed in, so a read landing mid-word never takes it back.
 */
function TitleField(props: {
  value: string;
  label: string;
  onCommit: (title: string) => Promise<void>;
}) {
  let field!: HTMLTextAreaElement;
  let typed = false;
  const size = () => {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!typed) field.value = value;
        size();
      },
    ),
  );
  async function commit() {
    if (!typed) return;
    typed = false;
    await props.onCommit(field.value);
    // Kept or refused, the field shows the title as it now is, unless typed in again meanwhile.
    if (!typed) field.value = props.value;
    size();
  }
  return (
    <textarea
      ref={field}
      class="inspector-title"
      rows={1}
      aria-label={props.label}
      onInput={() => {
        typed = true;
        size();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          typed = false;
          field.value = props.value;
        }
      }}
      onBlur={() => void commit()}
    />
  );
}

/** A line that opens a choice, saying what is chosen now. */
function ChoiceLine(props: {
  icon: LucideIcon;
  label: string;
  value: string;
  page: string;
  onClick: () => void;
}) {
  return (
    <button type="button" class="inspector-line" data-page={props.page} onClick={props.onClick}>
      <Dynamic component={props.icon} size={18} aria-hidden="true" />
      <span class="inspector-line-label">{props.label}</span>
      <span class="inspector-line-value">{props.value}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

/** A line that does what it says, with what follows from it under its name. */
function ActionLine(props: {
  icon: LucideIcon;
  label: string;
  sub?: string | undefined;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="inspector-line"
      classList={{ danger: props.danger }}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Dynamic component={props.icon} size={18} aria-hidden="true" />
      <span class="inspector-line-label">
        {props.label}
        <Show when={props.sub}>{(sub) => <span class="inspector-line-sub">{sub()}</span>}</Show>
      </span>
    </button>
  );
}

/** How long a picked day stays as it is before it is sent, unless its field is left sooner. */
const DATE_SETTLES_MS = 700;

/**
 * A day, sent once its field is left or the day has stayed as it is a moment: typed by keyboard,
 * a date changes at each keystroke of its year, through days nobody meant. What is picked is the
 * person's until then, and a fresh read shows the record's day only in a field left alone.
 */
function DateLine(props: {
  icon: LucideIcon;
  label: string;
  value: Day | null;
  overdue?: boolean;
  onChange: (day: string) => void;
}) {
  let input!: HTMLInputElement;
  let settling: ReturnType<typeof setTimeout> | undefined;
  let picked: string | null = null;
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (picked === null) input.value = value ?? "";
      },
    ),
  );
  function send() {
    clearTimeout(settling);
    if (picked === null) return;
    const day = picked;
    picked = null;
    if (day !== (props.value ?? "")) props.onChange(day);
  }
  onCleanup(send);
  return (
    <label class="inspector-line inspector-date">
      <Dynamic component={props.icon} size={18} aria-hidden="true" />
      <span class="inspector-line-label">{props.label}</span>
      <input
        ref={input}
        type="date"
        classList={{ overdue: props.overdue }}
        onChange={(event) => {
          picked = event.currentTarget.value;
          clearTimeout(settling);
          settling = setTimeout(send, DATE_SETTLES_MS);
        }}
        onBlur={send}
      />
    </label>
  );
}

function ChoiceButton(props: {
  icon: LucideIcon;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class="inspector-choice"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Dynamic component={props.icon} size={16} aria-hidden="true" />
      <span>{props.children}</span>
      <Show when={props.pressed}>
        <Check size={16} aria-hidden="true" class="inspector-choice-check" />
      </Show>
    </button>
  );
}

function TaskPage(props: {
  task: Task;
  timeZone: string;
  projectName: (id: string) => string | undefined;
  sending: boolean;
  onRename: (typed: string) => Promise<void>;
  onDate: (field: keyof TaskDates, day: string) => void;
  onPush: (kind: "recurrence" | "delegate" | "wait" | "place") => void;
  onMakeProject: () => void;
  onDrop: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const finishing = createFinishing({
    task: () => props.task,
    onTask: props.onTask,
    onProblem: props.onProblem,
  });
  const open = () => openState(props.task);
  const [origin, setOrigin] = createSignal<Entry | null>(null);
  // The Entry it came from, which says what there is to say about it (section 3.3).
  const { read: readOrigin } = latestRead(async (current) => {
    try {
      const result = await callTool("get_entry", { id: props.task.origin_entry });
      if (current() && result.ok) setOrigin(result.value);
    } catch {
      // With no network the page shows the Task without its Entry.
    }
  });
  // A Project Attention does not list, being at an end, is named by reading it.
  const [closedProject, setClosedProject] = createSignal<{ id: string; name: string } | null>(null);
  const { read: readProject } = latestRead(async (current, id: string) => {
    try {
      const result = await callTool("get_project", { id });
      if (current() && result.ok) setClosedProject({ id, name: result.value.name });
    } catch {
      // With no network it is named as a Project, not by its name.
    }
  });
  createEffect(() => {
    const id = props.task.project;
    if (id !== null && props.projectName(id) === undefined) void readProject(id);
  });
  const projectNamed = (id: string) =>
    props.projectName(id) ?? (closedProject()?.id === id ? closedProject()?.name : undefined);
  createEffect(
    on(
      () => props.task.origin_entry,
      () => void readOrigin(),
    ),
  );

  const waitsOn = () => {
    const waiting = open()?.waiting ?? [];
    if (waiting.length === 0) return "Nothing";
    if (waiting.length === 1) return waitedOnName((waiting[0] as (typeof waiting)[number]).on);
    return `${waiting.length} Tasks and Projects`;
  };

  async function toggle(box: HTMLInputElement) {
    await finishing.setFinished(box.checked);
    box.checked = finishing.shownFinished();
  }

  return (
    <>
      <div class="inspector-title-row">
        <label class="inspector-control">
          <input
            type="checkbox"
            aria-label={props.task.title}
            checked={finishing.shownFinished()}
            disabled={finishing.sending() || finishing.dropped()}
            onChange={(event) => void toggle(event.currentTarget)}
          />
        </label>
        <TitleField value={props.task.title} label="Title" onCommit={props.onRename} />
      </div>
      <p class="inspector-marks">
        <TaskMarks task={props.task} timeZone={props.timeZone} />
      </p>
      <Show when={props.task.state.is === "open"}>
        <div class="inspector-group">
          <DateLine
            icon={Calendar}
            label="Due Date"
            value={props.task.due_date}
            overdue={open()?.overdue != null}
            onChange={(day) => props.onDate("due_date", day)}
          />
          <DateLine
            icon={Clock}
            label="Defer Date"
            value={props.task.defer_date}
            onChange={(day) => props.onDate("defer_date", day)}
          />
          <ChoiceLine
            icon={Repeat}
            label="Recurrence"
            value={props.task.recurrence ? recurrenceWords(props.task.recurrence) : "None"}
            page="recurrence"
            onClick={() => props.onPush("recurrence")}
          />
        </div>
        <div class="inspector-group">
          <ChoiceLine
            icon={UserRound}
            label="Delegated to"
            value={open()?.delegated?.to.name ?? "Nobody"}
            page="delegate"
            onClick={() => props.onPush("delegate")}
          />
          <ChoiceLine
            icon={Hourglass}
            label="Waits on"
            value={waitsOn()}
            page="wait"
            onClick={() => props.onPush("wait")}
          />
          <ChoiceLine
            icon={Folder}
            label="Project"
            value={
              props.task.project === null
                ? "None"
                : (projectNamed(props.task.project) ?? "A Project")
            }
            page="place"
            onClick={() => props.onPush("place")}
          />
        </div>
        <div class="inspector-group">
          <ActionLine
            icon={FolderPlus}
            label="Turn into a Project"
            sub="The Task becomes its first"
            disabled={props.sending}
            onClick={props.onMakeProject}
          />
        </div>
        <div class="inspector-group">
          <ActionLine
            icon={Ban}
            label="Drop"
            sub="Not doing it. It stays on its Entry."
            disabled={props.sending}
            onClick={props.onDrop}
          />
          <ActionLine
            icon={Trash}
            label="Delete"
            sub="To the Trash for 30 days"
            danger
            disabled={props.sending}
            onClick={props.onDelete}
          />
        </div>
      </Show>
      {/* At an end, it is reopened or deleted from here: the round control does not reopen a
          Dropped one (section 3.4). */}
      <Show when={props.task.state.is !== "open"}>
        <div class="inspector-group">
          <ActionLine
            icon={RotateCcw}
            label="Reopen"
            sub="Open again, to be done"
            disabled={props.sending}
            onClick={props.onReopen}
          />
          <ActionLine
            icon={Trash}
            label="Delete"
            sub="To the Trash for 30 days"
            danger
            disabled={props.sending}
            onClick={props.onDelete}
          />
        </div>
      </Show>
      <Show when={origin()}>
        {(entry) => (
          <figure class="inspector-origin">
            <figcaption>From its Entry</figcaption>
            <Words words={entry().words} images={imageLoadingIn(entry())} />
          </figure>
        )}
      </Show>
    </>
  );
}

function ProjectPage(props: {
  project: Project;
  timeZone: string;
  sending: boolean;
  onRename: (typed: string) => Promise<void>;
  onDue: (day: string) => void;
  onMove: () => void;
  onOpenTask: (task: Task) => void;
  onEnd: (end: "finish_project" | "drop_project") => void;
  onReopen: () => void;
  onDelete: () => void;
  onChanged: () => void;
  onProblem: (message: string) => void;
}) {
  const overdue = () => props.project.state.is === "open" && props.project.state.overdue !== null;
  const open = () => openTasks(props.project);
  const drops = () =>
    open() === 0 ? undefined : `Drops its ${open()} open ${open() === 1 ? "Task" : "Tasks"}`;
  return (
    <>
      <div class="inspector-title-row">
        <span class="inspector-control">
          <Folder size={20} aria-hidden="true" />
        </span>
        <TitleField value={props.project.name} label="Name" onCommit={props.onRename} />
      </div>
      <p class="inspector-marks">
        <span class="task-mark">Project</span>
        <Show when={props.project.state.is !== "open"}>
          <span class="task-mark">
            {props.project.state.is === "finished" ? "Finished" : "Dropped"}
          </span>
        </Show>
        <Show when={props.project.due_date}>
          {(due) => <DueMark due={due()} overdue={overdue()} timeZone={props.timeZone} />}
        </Show>
        <Show when={props.project.state.is === "open" && open() === 0}>
          <span class="task-mark flag">Needs a next Task or finishing</span>
        </Show>
      </p>
      <div class="inspector-group">
        <DateLine
          icon={Calendar}
          label="Due Date"
          value={props.project.due_date}
          overdue={overdue()}
          onChange={props.onDue}
        />
        <ChoiceLine
          icon={ArrowRightLeft}
          label="Move to another Context"
          value=""
          page="move"
          onClick={props.onMove}
        />
      </div>
      <h4 class="inspector-group-title">Its Tasks</h4>
      <Show when={props.project.tasks.length > 0} fallback={<p class="peer-note">No Tasks yet.</p>}>
        <ul class="task-list inspector-group" aria-label={`Tasks in ${props.project.name}`}>
          <For each={props.project.tasks}>
            {(task) => (
              <TaskRow
                task={task}
                timeZone={props.timeZone}
                openKey={`task-${task.id}`}
                onOpen={() => props.onOpenTask(task)}
                onTask={() => props.onChanged()}
                onProblem={props.onProblem}
              />
            )}
          </For>
        </ul>
      </Show>
      <div class="inspector-group">
        <Show
          when={props.project.state.is === "open"}
          fallback={
            <ActionLine
              icon={RotateCcw}
              label="Reopen"
              sub="Its Tasks dropped with it stay dropped"
              disabled={props.sending}
              onClick={props.onReopen}
            />
          }
        >
          <ActionLine
            icon={Check}
            label="Finish"
            sub={drops()}
            disabled={props.sending}
            onClick={() => props.onEnd("finish_project")}
          />
          <ActionLine
            icon={Ban}
            label="Drop"
            sub={drops()}
            disabled={props.sending}
            onClick={() => props.onEnd("drop_project")}
          />
        </Show>
        <ActionLine
          icon={Trash}
          label="Delete"
          sub="Its Tasks stay, in no Project"
          danger
          disabled={props.sending}
          onClick={props.onDelete}
        />
      </div>
    </>
  );
}

/** The Recurrences offered for a Task, each read from its Due Date, which it needs first. */
function RecurrencePage(props: {
  task: Task;
  sending: boolean;
  onDate: (day: string) => void;
  onChoose: (rule: NewRecurrence | null) => void;
}) {
  const held = () => props.task.recurrence;
  return (
    <Show
      when={props.task.due_date}
      fallback={
        <>
          <p class="inspector-note">A Recurrence counts from a Due Date: give it one first.</p>
          <div class="inspector-group">
            <DateLine icon={Calendar} label="Due Date" value={null} onChange={props.onDate} />
          </div>
        </>
      }
    >
      {(due) => (
        <fieldset class="inspector-choices">
          <legend class="visually-hidden">Recurrence</legend>
          <ChoiceButton
            icon={X}
            pressed={held() === null}
            disabled={props.sending}
            onClick={() => props.onChoose(null)}
          >
            No Recurrence
          </ChoiceButton>
          <Show
            when={(() => {
              const rule = held();
              return rule && !recurrencesOffered(due()).some((offered) => sameRule(rule, offered))
                ? rule
                : null;
            })()}
          >
            {(own) => (
              <ChoiceButton icon={Repeat} pressed onClick={() => undefined}>
                {recurrenceWords(own())}
              </ChoiceButton>
            )}
          </Show>
          <For each={recurrencesOffered(due())}>
            {(rule) => (
              <ChoiceButton
                icon={Repeat}
                pressed={(() => {
                  const own = held();
                  return own !== null && sameRule(own, rule);
                })()}
                disabled={props.sending}
                onClick={() => props.onChoose(rule)}
              >
                {recurrenceWords(rule, due())}
              </ChoiceButton>
            )}
          </For>
        </fieldset>
      )}
    </Show>
  );
}
