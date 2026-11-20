import type { ContextListing, MoveKind, MoveUnit, RecordKind } from "@praxis/domain";
import { createContext, createSignal, For, onMount, Show, useContext } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { callDeploymentTool, unreachableMessage, useCallTool } from "./tools.ts";

/**
 * Where a record shown in the current Context can be moved: that Context, and the others not
 * retired, as the Deployment lists them.
 */
export type MoveTargets = { from: string; to: () => ContextListing[] };

export const CurrentMoveTargets = createContext<MoveTargets>();

/** What crosses the boundary, said once wherever a move is offered (section 3.9). */
const DROPPED =
  "Mentions, References and waits between what moves and what stays, delegations, a place in a Project that stays, a Follow-up link to an Entry that stays and a Standing mark are dropped. The words are kept.";

const KIND_NAME: Record<RecordKind, string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
};

/**
 * Move an Entry or a Project to another Context (section 3.9): the person picks the Context and is
 * shown the whole unit, read with `get_move_unit`, before confirming. The move takes exactly the
 * unit shown; changed since, it is refused, and the unit is read again. Once it has moved, the
 * live channel takes it off the screen, so what moved is said through `onMoved`.
 */
export function MoveRecord(props: {
  record: { kind: MoveKind; id: string };
  onMoved: (said: string) => void;
  onClose: () => void;
}) {
  const callTool = useCallTool();
  const targets = useContext(CurrentMoveTargets);
  const others = () => targets?.to() ?? [];
  const [unit, setUnit] = createSignal<MoveUnit | null>(null);
  const [to, setTo] = createSignal<string>(others()[0]?.id ?? "");
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);

  // The last read wins, so a unit read again after a refusal never gives way to an earlier answer.
  const { read: readUnit } = latestRead(async (current) => {
    try {
      const result = await callTool("get_move_unit", props.record);
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      setUnit(result.value);
    } catch (error) {
      if (current()) setProblem(unreachableMessage(error));
    }
  });

  onMount(() => void readUnit());

  async function move(event: SubmitEvent) {
    event.preventDefault();
    const shown = unit();
    const destination = others().find((context) => context.id === to());
    if (!targets || !shown || !destination) return;
    setSending(true);
    try {
      const result = await callDeploymentTool("move_record", {
        from: targets.from,
        to: destination.id,
        record: props.record,
        unit: shown.unit.map(({ id }) => id),
      });
      if (!result.ok) {
        setProblem(result.error.message);
        // What was shown is not what would move: it cannot be confirmed until read again.
        if (result.error.code === "refused") {
          setUnit(null);
          await readUnit();
        }
        return;
      }
      const { record, arrived } = result.value.record;
      props.onMoved(
        arrived
          ? `“${record.summary}” moved to ${destination.name}, with ${unitCount(shown)}.`
          : `“${record.summary}” is on its way to ${destination.name}, with ${unitCount(shown)}: it shows there shortly.`,
      );
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  const heading = () => `Move this ${KIND_NAME[props.record.kind]} to another Context`;

  return (
    <form class="move-record" aria-label={heading()} onSubmit={(event) => void move(event)}>
      <Show
        when={others().length > 0}
        fallback={<p class="settings-note">There is no other Context to move it to.</p>}
      >
        <label>
          Move to
          <select value={to()} onChange={(event) => setTo(event.currentTarget.value)}>
            <For each={others()}>
              {(context) => <option value={context.id}>{context.name}</option>}
            </For>
          </select>
        </label>
      </Show>
      <Show when={unit()}>
        {(shown) => (
          <>
            <p class="move-record-note">Everything that moves with it:</p>
            <ul class="move-record-unit" aria-label="What moves">
              <For each={shown().unit}>
                {(record) => (
                  <li>
                    <span class="task-mark">{KIND_NAME[record.kind]}</span> {record.summary}
                  </li>
                )}
              </For>
            </ul>
            <Show when={shown().in_the_trash.length > 0}>
              <p class="problem" role="alert">
                A Task from what would move is in the Trash, and a Task never leaves its Origin
                Entry: restore it, or remove it for good, before moving.{" "}
                {shown()
                  .in_the_trash.map(({ summary }) => `“${summary}”`)
                  .join(", ")}
              </p>
            </Show>
            <p class="move-record-note">{DROPPED}</p>
          </>
        )}
      </Show>
      <div class="move-record-actions">
        <button
          type="submit"
          disabled={
            sending() ||
            unit() === null ||
            (unit()?.in_the_trash.length ?? 0) > 0 ||
            others().length === 0
          }
        >
          Move it
        </button>
        <button type="button" class="quiet" disabled={sending()} onClick={() => props.onClose()}>
          Keep it here
        </button>
      </div>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}

/** How many records move with the one asked for, said in words. */
function unitCount(unit: MoveUnit): string {
  const more = unit.unit.length - 1;
  return more === 0 ? "nothing else" : more === 1 ? "1 more record" : `${more} more records`;
}
