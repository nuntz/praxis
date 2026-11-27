import { type AheadItem, type Task, utcMidnight } from "@praxis/domain";
import { For, Show } from "solid-js";
import { followAttentionView, keyedBy } from "./attention-read.ts";
import { DueMark, formatDay, type OnFinished, TaskItem } from "./TaskItem.tsx";

/** A day as the weeks ahead head it, with its weekday, in the Device's locale. */
const dayHeading = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/**
 * The weeks ahead, opened from Attention's Due section and shown in Attention, not a fourth peer
 * (section 8.3): what `view_ahead` lists in the days it covers unless asked, by day. A Recurrence's
 * Occurrences to come are marked as not made yet, and only what exists is finished from here.
 * Derived on the server, like Attention, so any change to a Task, a Project or the Context's
 * settings is answered by reading it again.
 */
export function WeeksAhead(props: { id: string; timeZone: string; onFinished: OnFinished }) {
  // A Task finished Unsent leaves it at once, as it leaves the rest of Attention (section 8.8).
  // It is not in the Offline Copy: with no network it says so.
  const { view, problem, setProblem, read } = followAttentionView({
    tool: "view_ahead",
    without: (shown, finishedUnsent) => ({
      ...shown,
      items: shown.items.filter((item) => item.kind !== "task" || !finishedUnsent(item.task)),
    }),
    // A Task can be listed twice, on its Defer Date and on its Due Date.
    keyed: (shown) => ({
      ...shown,
      items: shown.items.map((item) =>
        keyedBy(
          item,
          item.kind === "task"
            ? `${item.which}-task-${item.task.id}`
            : item.kind === "project"
              ? `project-${item.project.id}`
              : `${item.which}-occurrence-${item.occurrence.follows}-${item.occurrence.due_date}`,
        ),
      ),
    }),
  });

  // The days by themselves, so a day's heading, and its list, stays as its items change.
  const items = () => view()?.items ?? [];
  const days = () => [...new Set(items().map((item) => item.on))];

  return (
    <section id={props.id} class="weeks-ahead" aria-label="The weeks ahead">
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={view()}>
        {(shown) => (
          <>
            <For each={days()}>
              {(day) => (
                <div class="weeks-ahead-day">
                  <h4 class="weeks-ahead-day-title">{dayHeading.format(utcMidnight(day))}</h4>
                  <ul class="task-list">
                    <For each={items().filter((item) => item.on === day)}>
                      {(item) => (
                        <AheadEntry
                          item={item}
                          timeZone={props.timeZone}
                          onTask={() => void read()}
                          onFinished={props.onFinished}
                          onProblem={setProblem}
                        />
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
            <Show when={shown().items.length === 0}>
              <p class="peer-note">Nothing is due or Deferred until {formatDay(shown().to)}.</p>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}

/** One thing listed on a day of the weeks ahead. */
function AheadEntry(props: {
  item: AheadItem;
  timeZone: string;
  onTask: (task: Task) => void;
  onFinished: OnFinished;
  onProblem: (message: string) => void;
}) {
  const item = props.item;
  if (item.kind === "task") {
    return (
      <TaskItem
        task={item.task}
        timeZone={props.timeZone}
        onTask={props.onTask}
        onFinished={props.onFinished}
        onProblem={props.onProblem}
      />
    );
  }
  if (item.kind === "project") {
    return (
      <li class="task attention-project">
        <span class="task-title">{item.project.name}</span>
        <span class="task-mark">Project</span>
        <DueMark due={item.on} overdue={false} timeZone={props.timeZone} />
      </li>
    );
  }
  // It does not exist yet, so there is nothing to finish, open or link to.
  return (
    <li class="task future-occurrence">
      <span class="task-title">{item.occurrence.title}</span>
      <span class="task-mark">Not made yet</span>
      <DueMark due={item.occurrence.due_date} overdue={false} timeZone={props.timeZone} />
      <Show when={item.occurrence.defer_date}>
        {(defer) => <span class="task-mark">Defer Date {formatDay(defer())}</span>}
      </Show>
    </li>
  );
}
