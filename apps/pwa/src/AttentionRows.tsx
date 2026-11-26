import { type Day, dayIn, type Project, type Task, utcMidnight } from "@praxis/domain";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Folder from "lucide-solid/icons/folder";
import Hourglass from "lucide-solid/icons/hourglass";
import Repeat from "lucide-solid/icons/repeat";
import UserRound from "lucide-solid/icons/user-round";
import { createUniqueId, type JSX, Show } from "solid-js";
import { todayIn } from "./days.tsx";
import { createFinishing, DueMark, TaskMarks } from "./TaskItem.tsx";

/**
 * A row of Attention (section 8.3): one line for its title, two when it is long, the one mark that
 * matters most at its end, and the rest as small signs. Every mark is in its description, for a
 * screen reader. The row opens the record's page, where everything it has can be changed.
 */

/** A day short, as a row says it: the year only when it is not this one. */
export function shortDay(day: Day, today: Day): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(utcMidnight(day));
}

/** The mark a row leads with, and which state it says, so the signs leave that one out. */
type Lead = {
  text: string;
  tone?: "overdue" | "today" | "flag";
  says?: "waiting" | "delegated";
};

/**
 * The mark a Task's row leads with: Overdue, then due today, then why the place shows it, who it
 * is Delegated to, the day it is Deferred until, and its Due Date. Overdue and due today are never
 * left out, since they are what Attention is for.
 */
function taskLead(task: Task, timeZone: string, place: string | undefined): Lead | null {
  const today = todayIn(timeZone);
  const state = task.state;
  if (state.is !== "open") return { text: state.is === "finished" ? "Finished" : "Dropped" };
  const due = task.due_date;
  if (due !== null && state.overdue !== null) {
    return { text: `${shortDay(due, today)}, Overdue`, tone: "overdue" };
  }
  if (due === today) return { text: "Due today", tone: "today" };
  if (place !== undefined) return { text: place };
  // The Person and the day it was Delegated, as the Delegated section lists it (section 8.3).
  if (state.delegated) {
    const since = shortDay(dayIn(Date.parse(state.delegated.since), timeZone), today);
    return { text: `${state.delegated.to.name}, ${since}`, says: "delegated" };
  }
  if (state.deferred) return { text: `Deferred until ${shortDay(state.deferred.until, today)}` };
  if (state.waiting) return { text: "Waiting", says: "waiting" };
  if (due !== null) return { text: `Due ${shortDay(due, today)}` };
  return null;
}

/** A Task in Attention, finished from its round control and opened by the rest of its row. */
export function TaskRow(props: {
  task: Task;
  timeZone: string;
  /** Why the place shows it, said first after Overdue and due today: "Wait ended 24 Nov". */
  place?: string | undefined;
  /** Its id on the page, so the focus can come back to it once its page is closed. */
  openKey: string;
  onOpen: () => void;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const marks = createUniqueId();
  const finishing = createFinishing({
    task: () => props.task,
    onTask: props.onTask,
    onProblem: props.onProblem,
  });
  const lead = () => taskLead(props.task, props.timeZone, props.place);
  const open = () => (props.task.state.is === "open" ? props.task.state : null);

  async function toggle(box: HTMLInputElement) {
    await finishing.setFinished(box.checked);
    box.checked = finishing.shownFinished();
  }

  return (
    <li class="task attention-row" classList={{ closed: finishing.closed() }}>
      <label class="attention-row-control">
        <input
          type="checkbox"
          aria-label={props.task.title}
          checked={finishing.shownFinished()}
          disabled={finishing.sending() || finishing.dropped()}
          onChange={(event) => void toggle(event.currentTarget)}
        />
      </label>
      <button
        type="button"
        class="attention-row-open"
        data-open-key={props.openKey}
        aria-haspopup="dialog"
        aria-describedby={marks}
        onClick={() => props.onOpen()}
      >
        <span class="task-title">{props.task.title}</span>
        <span class="attention-row-signs" aria-hidden="true">
          <Show when={props.task.recurrence}>
            <Repeat size={14} />
          </Show>
          <Show when={open()?.waiting && lead()?.says !== "waiting"}>
            <Hourglass size={14} />
          </Show>
          <Show when={open()?.delegated && lead()?.says !== "delegated"}>
            <UserRound size={14} />
          </Show>
        </span>
        <LeadMark lead={lead()} />
        <ChevronRight size={16} aria-hidden="true" class="attention-row-chevron" />
      </button>
      <span id={marks} class="visually-hidden">
        <Show when={props.place}>{(place) => <span>{place()}, </span>}</Show>
        <TaskMarks task={props.task} timeZone={props.timeZone} />
      </span>
    </li>
  );
}

/** A Project in Attention, opened by its row to show its Tasks and what can be done with it. */
export function ProjectRow(props: {
  project: Project;
  timeZone: string;
  /** Said when it is listed for its Due Date rather than among the Projects. */
  dueListed?: boolean;
  actionable?: number;
  noOpenTask?: boolean;
  openKey: string;
  onOpen: () => void;
}) {
  const marks = createUniqueId();
  const today = () => todayIn(props.timeZone);
  const overdue = () => props.project.state.is === "open" && props.project.state.overdue !== null;
  const lead = (): Lead => {
    const due = props.project.due_date;
    if (due !== null && overdue()) {
      return { text: `${shortDay(due, today())}, Overdue`, tone: "overdue" };
    }
    if (due === today()) return { text: "Due today", tone: "today" };
    if (props.noOpenTask) return { text: "Needs a next Task", tone: "flag" };
    if (props.dueListed) return { text: "Project" };
    return { text: `${props.actionable ?? 0} actionable` };
  };
  return (
    <li class="task attention-row attention-project-row">
      <span class="attention-row-control">
        <Folder size={18} aria-hidden="true" />
      </span>
      <button
        type="button"
        class="attention-row-open"
        data-open-key={props.openKey}
        aria-haspopup="dialog"
        aria-describedby={marks}
        onClick={() => props.onOpen()}
      >
        <span class="task-title">{props.project.name}</span>
        <LeadMark lead={lead()} />
        <ChevronRight size={16} aria-hidden="true" class="attention-row-chevron" />
      </button>
      <span id={marks} class="visually-hidden">
        Project
        <Show when={props.actionable !== undefined}>, {props.actionable} actionable</Show>
        <Show when={props.project.due_date}>
          {(due) => (
            <>
              , <DueMark due={due()} overdue={overdue()} timeZone={props.timeZone} />
            </>
          )}
        </Show>
        <Show when={props.noOpenTask}>, Needs a next Task or finishing</Show>
      </span>
    </li>
  );
}

function LeadMark(props: { lead: Lead | null }): JSX.Element {
  return (
    <Show when={props.lead}>
      {(lead) => (
        <span
          class="attention-row-lead"
          classList={{
            overdue: lead().tone === "overdue",
            "due-today": lead().tone === "today",
            flag: lead().tone === "flag",
          }}
          aria-hidden="true"
        >
          {lead().text}
        </span>
      )}
    </Show>
  );
}
