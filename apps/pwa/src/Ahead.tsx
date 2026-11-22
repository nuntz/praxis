import { type Ahead, type AheadItem, type Change, type Task, utcMidnight } from "@praxis/domain";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { DueMark, formatDay, TaskItem } from "./TaskItem.tsx";
import { unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { onSent, toSend, unsent, unsentFinishOf } from "./unsent.ts";

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
export function WeeksAhead(props: { id: string; timeZone: string }) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const live = useLive();
  const [answered, setView] = createSignal<Ahead | null>(null);
  // A Task finished Unsent leaves it at once, as it leaves the rest of Attention (section 8.8).
  const view = createMemo(() => {
    const shown = answered();
    // Left as read when there is none, so nothing shown in it is made afresh.
    if (!shown || !unsent().some((write) => write.kind === "finish" && toSend(write))) {
      return shown;
    }
    const items = shown.items.filter(
      (item) => item.kind !== "task" || unsentFinishOf(item.task.id) === null,
    );
    return { ...shown, items };
  });
  const [problem, setProblem] = createSignal<string | null>(null);
  const { read } = latestRead(async (current) => {
    try {
      const result = await callTool("view_ahead", {});
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      setView(result.value);
    } catch (error) {
      // It is not in the Offline Copy: with no network it says so.
      if (current()) setProblem(unreachableMessage(error));
    }
  });

  /** As for Attention: an Entry's words move nothing in it. */
  async function changed(change: Change) {
    if (change.effects.some((effect) => effect.kind !== "entry")) await read();
  }

  onMount(async () => {
    await live.ready;
    await read();
  });
  onCleanup(live.listen({ changed, readAfresh: read }));
  onCleanup(
    onSent((sent) => {
      if (sent.context === contextId && sent.kind === "finish") void read();
    }),
  );

  const days = () => {
    const items = view()?.items ?? [];
    return [...Map.groupBy(items, (item) => item.on)].map(([day, listed]) => ({ day, listed }));
  };

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
              {({ day, listed }) => (
                <div class="weeks-ahead-day">
                  <h4 class="weeks-ahead-day-title">{dayHeading.format(utcMidnight(day))}</h4>
                  <ul class="task-list">
                    <For each={listed}>
                      {(item) => (
                        <AheadEntry
                          item={item}
                          timeZone={props.timeZone}
                          onTask={() => void read()}
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
  onProblem: (message: string) => void;
}) {
  const item = props.item;
  if (item.kind === "task") {
    return (
      <TaskItem
        task={item.task}
        timeZone={props.timeZone}
        onTask={props.onTask}
        onProblem={props.onProblem}
      />
    );
  }
  if (item.kind === "project") {
    return (
      <li class="task attention-project">
        <span class="task-title">{item.project.name}</span>
        <span class="task-mark">Project</span>
        <DueMark due={item.on} overdue={false} />
      </li>
    );
  }
  // It does not exist yet, so there is nothing to finish, open or link to.
  return (
    <li class="task future-occurrence">
      <span class="task-title">{item.occurrence.title}</span>
      <span class="task-mark">Not made yet</span>
      <DueMark due={item.occurrence.due_date} overdue={false} />
      <Show when={item.occurrence.defer_date}>
        {(defer) => <span class="task-mark">Defer Date {formatDay(defer())}</span>}
      </Show>
    </li>
  );
}
