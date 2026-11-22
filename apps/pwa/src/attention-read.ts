import type { Change, Task, ToolOutput } from "@praxis/domain";
import { type Accessor, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { Unreachable, unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { onSent, toSend, unsent, unsentFinishOf } from "./unsent.ts";

/** The views Attention shows: its own sections, and the weeks ahead opened from its Due section. */
type AttentionTool = "view_attention" | "view_ahead";

export type FollowedView<V> = {
  /** The view as last read, without the Tasks finished Unsent on this Device. */
  view: Accessor<V | null>;
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
 *
 * Each view is its own shape, so it says how to drop those Tasks from it: `without` is given the
 * view as read and whether a Task is finished Unsent, and is called only when some Task is, so with
 * none the view is left as read and nothing shown in it is made afresh.
 */
export function followAttentionView<N extends AttentionTool>(options: {
  tool: N;
  without: (view: ToolOutput[N], finishedUnsent: (task: Task) => boolean) => ToolOutput[N];
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
    setAnswered(() => view);
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

  const view = createMemo(() => {
    const shown = answered();
    if (!shown || !unsent().some((write) => write.kind === "finish" && toSend(write))) {
      return shown;
    }
    return options.without(shown, (task) => unsentFinishOf(task.id) !== null);
  });

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

  return { view, problem, setProblem, read };
}
