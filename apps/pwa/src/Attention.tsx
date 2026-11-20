import type {
  Attention as AttentionView,
  CameUp,
  Change,
  Project,
  ProjectInAttention,
  Task,
} from "@praxis/domain";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { HeldChangeItem, heldAnchor, useHeldChanges } from "./HeldChanges.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { MoveRecord } from "./Move.tsx";
import { StandingNotices } from "./Notices.tsx";
import { DueMark, formatDay, TaskItem } from "./TaskItem.tsx";
import { unreachableMessage, useCallTool } from "./tools.ts";

/**
 * What the Attention column holds: the standing Notices, the Held Changes left for the
 * person's tap, then the sections of `view_attention`, in their order (section 8.3). It has no
 * composer. A Task is finished from it, and a Project opened to show its Tasks.
 * Its sections are derived on the server from the whole Context, so any change to a Task, a
 * Project or the Context's settings is answered by reading the view again.
 */
export function Attention(props: {
  timeZone: string;
  /** The Due section's count, each time the view is read. */
  onDueCount: (count: number) => void;
}) {
  const callTool = useCallTool();
  const live = useLive();
  const heldChanges = useHeldChanges();
  const [view, setView] = createSignal<AttentionView | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  // What the last move of a Project said, once it has left Attention (section 3.9).
  const [moved, setMoved] = createSignal<string | null>(null);
  // The last read wins: an answer a later read overtook is dropped.
  const { read } = latestRead(async (current) => {
    try {
      const result = await callTool("view_attention", {});
      if (!current()) return;
      if (!result.ok) {
        setProblem(result.error.message);
        return;
      }
      setProblem(null);
      setView(result.value);
      props.onDueCount(result.value.due.length);
    } catch (error) {
      if (current()) setProblem(unreachableMessage(error));
    }
  });

  /**
   * A change to a Task, a Project, a Person a Task is Delegated to, or the Context, whose time
   * zone moves today, moves Attention. An Entry's words move nothing in it.
   */
  async function changed(change: Change) {
    if (change.effects.some((effect) => effect.kind !== "entry")) {
      await read();
    }
  }

  // Read once the live channel is open, so a change made meanwhile is either read or brought.
  onMount(async () => {
    await live.ready;
    await read();
  });
  onCleanup(live.listen({ changed, readAfresh: read }));

  const dayOf = (at: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: props.timeZone }).format(
      new Date(at),
    );

  /** Why and when a Task came up, said in its mark. */
  function cameUpMark(came: CameUp) {
    const said =
      came.because === "defer_date_came"
        ? `Defer Date came ${formatDay(came.on)}`
        : `${came.because === "taken_back" ? "Taken back" : "Wait ended"} ${dayOf(came.at)}`;
    return <span class="task-mark">{said}</span>;
  }

  const taskItem = (task: Task, mark?: JSX.Element) => (
    <TaskItem
      task={task}
      timeZone={props.timeZone}
      mark={mark}
      onTask={() => void read()}
      onProblem={setProblem}
    />
  );

  return (
    <div class="peer-body attention-body">
      {/* Standing Notices sit above the sections of the view, and are not counted (section 8.3). */}
      <StandingNotices />
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={moved()}>
        {(said) => (
          <p class="moved" role="status">
            {said()}
          </p>
        )}
      </Show>
      <Section id="held-changes" title="Held Changes" items={heldChanges.all()}>
        {(held) => (
          <li>
            <HeldChangeItem held={held} anchor={heldAnchor(held.id)} />
          </li>
        )}
      </Section>
      <Show when={view()}>
        {(shown) => (
          <>
            <Section id="due" title="Due" items={shown().due}>
              {(item) =>
                item.kind === "task" ? (
                  taskItem(item.task)
                ) : (
                  <li class="task attention-project">
                    <span class="task-title">{item.project.name}</span>
                    <span class="task-mark">Project</span>
                    <ProjectDue project={item.project} />
                  </li>
                )
              }
            </Section>
            <Section
              id="newly-actionable"
              title="Newly actionable"
              items={shown().newly_actionable}
            >
              {(item) => taskItem(item.task, cameUpMark(item.came_up))}
            </Section>
            <Section id="delegated" title="Delegated" items={shown().delegated}>
              {(task) => taskItem(task)}
            </Section>
            <Section id="projects" title="Projects" items={shown().projects}>
              {(item) => <ProjectItem item={item} taskItem={taskItem} onMoved={setMoved} />}
            </Section>
            <Section id="loose" title="Loose" items={shown().loose}>
              {(task) => taskItem(task)}
            </Section>
            <Show
              when={
                heldChanges.all().length === 0 &&
                Object.values(shown()).every((items) => items.length === 0)
              }
            >
              <p class="peer-note">Nothing is open to act on.</p>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

/** One of Attention's sections, shown only when it holds something, in the order given. */
function Section<T>(props: {
  id: string;
  title: string;
  items: T[];
  children: (item: T) => JSX.Element;
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="attention-section" aria-labelledby={`attention-${props.id}`}>
        <h3 id={`attention-${props.id}`} class="attention-section-title">
          {props.title}
        </h3>
        <ul class="task-list">
          <For each={props.items}>{(item) => props.children(item)}</For>
        </ul>
      </section>
    </Show>
  );
}

/** A Project's Due Date, with Overdue marked on it. */
function ProjectDue(props: { project: Project }) {
  return (
    <Show when={props.project.due_date}>
      {(due) => (
        <DueMark
          due={due()}
          overdue={props.project.state.is === "open" && props.project.state.overdue !== null}
        />
      )}
    </Show>
  );
}

/**
 * An open Project, with its count of actionable Tasks and a flag when it has no open Task.
 * Expanding it shows its Tasks, those listed in another section and those at an end among them.
 */
function ProjectItem(props: {
  item: ProjectInAttention;
  taskItem: (task: Task) => JSX.Element;
  /** The Project moved to another Context, with its unit, as said. */
  onMoved: (said: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [moving, setMoving] = createSignal(false);
  const project = () => props.item.project;
  const tasksId = () => `attention-project-${project().id}`;
  return (
    <li class="attention-project">
      <button
        type="button"
        class="quiet attention-project-toggle"
        aria-expanded={expanded()}
        aria-controls={tasksId()}
        onClick={() => setExpanded((shown) => !shown)}
      >
        <span class="task-title">{project().name}</span>
        <span class="task-mark">{props.item.actionable_tasks} actionable</span>
      </button>
      <ProjectDue project={project()} />
      <Show when={props.item.no_open_task}>
        <span class="task-mark flag">Needs a next Task or finishing</span>
      </Show>
      <button
        type="button"
        class="quiet entry-mark"
        aria-expanded={moving()}
        aria-label={`Move ${project().name}`}
        onClick={() => setMoving((shown) => !shown)}
      >
        Move
      </button>
      <Show when={moving()}>
        <MoveRecord
          record={{ kind: "project", id: project().id }}
          onMoved={props.onMoved}
          onClose={() => setMoving(false)}
        />
      </Show>
      <ul
        id={tasksId()}
        class="task-list"
        aria-label={`Tasks in ${project().name}`}
        hidden={!expanded() || project().tasks.length === 0}
      >
        <Show when={expanded()}>
          <For each={project().tasks}>{(task) => props.taskItem(task)}</For>
        </Show>
      </ul>
    </li>
  );
}
