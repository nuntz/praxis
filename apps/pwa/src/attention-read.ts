import type { Change, Task, ToolOutput } from "@praxis/domain";
import { type Accessor, createComputed, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { Unreachable, unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { onSent, toSend, unsent, unsentFinishOf } from "./unsent.ts";

/** The views Attention shows: its own sections, and the weeks ahead opened from its Due section. */
type AttentionTool = "view_attention" | "view_ahead";

export type FollowedView<V> = {
  /**
   * The view as last read, without the Tasks finished Unsent on this Device: a store, each read
   * placed in it by id, so what a read leaves unchanged keeps its place on the screen.
   */
  view: Accessor<V | null>;
  /** The view as each read gave it, a new value each time, before anything is taken from it. */
  answered: Accessor<V | null>;
  /** What the last read, or a write made from the view, said went wrong. */
  problem: Accessor<string | null>;
  /** Say what a write made from the view found wrong, or clear it. */
  setProblem: (message: string | null) => void;
  /** Read the view again, as after a write made from it. */
  read: () => Promise<void>;
};

/**
 * One of Attention's views, read as each of them is (section 8.3), so a new one keeps their rules
 * by reading through this rather than by copying them:
 *
 * - The last read wins (`latestRead()`), and a read that never reached the tool says so.
 * - It reads once `live.ready` settles, again on any change whose Effects are not all on Entries,
 *   since an Entry's words move nothing in it, and afresh when the live channel says to.
 * - It reads again once a finish this Device sent for its Context is in.
 * - A Task finished Unsent leaves it at the tap, before the server has heard (section 8.8).
 * - Each read is reconciled into what is shown, a Task or Project matched by its id, so a row a
 *   read leaves unchanged keeps its element, and the focus on it (WCAG 2.4.3).
 *
 * Each view is its own shape, so it says how to drop those Tasks from it: `without` is given the
 * view as read and whether a Task is finished Unsent, and is called only when some Task is, so with
 * none the view is left as read. Its lists' items that only hold a record, such as Due's, are
 * given the id of the record they hold by `keyed`, so they are matched by it too.
 */
export function followAttentionView<N extends AttentionTool>(options: {
  tool: N;
  without: (view: ToolOutput[N], finishedUnsent: (task: Task) => boolean) => ToolOutput[N];
  /** The view with each item of its lists that is not itself a record given an `id` (`keyedBy`). */
  keyed: (view: ToolOutput[N]) => ToolOutput[N];
  /**
   * With no network, what to show in its place, or null to say it is unreachable. Asked only of the
   * read whose answer would be shown.
   */
  offline?: () => ToolOutput[N] | null;
  /** Each view shown, and whether it was the one `offline` gave. */
  onShown?: (offline: boolean) => void;
}): FollowedView<ToolOutput[N]> {
  type V = ToolOutput[N];
  const callTool = useCallTool();
  const contextId = useContextId();
  const live = useLive();
  const [answered, setAnswered] = createSignal<V | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);

  function show(view: V, offline: boolean) {
    setProblem(null);
    options.onShown?.(offline);
    setAnswered(() => options.keyed(view));
  }

  const { read } = latestRead(async (current) => {
    try {
      // Neither view takes anything but its defaults, and `N` is the tool called, so its answer
      // is its view.
      const result = await callTool<AttentionTool>(options.tool, {});
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      show(result.value as V, false);
    } catch (error) {
      if (!current()) return;
      const held = error instanceof Unreachable ? (options.offline?.() ?? null) : null;
      if (held === null) return setProblem(unreachableMessage(error));
      show(held, true);
    }
  });

  const [shown, setShown] = createStore<{ view: V | null }>({ view: null });
  createComputed(() => {
    const last = answered();
    const finishesToSend = unsent().some((write) => write.kind === "finish" && toSend(write));
    const view =
      last && finishesToSend
        ? options.without(last, (task) => unsentFinishOf(task.id) !== null)
        : last;
    // A copy, since the store changes what it is given in place: the read itself, and the Offline
    // Copy's view, stay as they were.
    setShown("view", reconcile(view && structuredClone(view), { key: "id" }));
  });
  const view = () => shown.view;

  /**
   * A change to a Task, a Project, a Person a Task is Delegated to, or the Context, whose time zone
   * moves today, moves the view. An Entry's words move nothing in it.
   */
  async function changed(change: Change) {
    if (change.effects.some((effect) => effect.kind !== "entry")) await read();
  }

  // Read once the live channel is open, so a change made meanwhile is either read or brought.
  onMount(async () => {
    await live.ready;
    await read();
  });
  onCleanup(live.listen({ changed, readAfresh: read }));
  // A finish sent from this Device moves the view as any change to a Task does.
  onCleanup(
    onSent((sent) => {
      if (sent.context === contextId && sent.kind === "finish") void read();
    }),
  );

  return { view, answered, problem, setProblem, read };
}

/**
 * An item of a view's list that only holds a record, such as `{ kind: "task", task }`, given an id
 * from the record it holds, so a read is matched to it as to a record.
 */
export function keyedBy<T extends object>(item: T, id: string): T {
  return { ...item, id };
}
