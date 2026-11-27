import { type Attention as AttentionView, type CameUp, dayIn, type Task } from "@praxis/domain";
import type { LucideIcon } from "lucide-solid";
import Calendar from "lucide-solid/icons/calendar";
import Circle from "lucide-solid/icons/circle";
import Clock from "lucide-solid/icons/clock";
import Folder from "lucide-solid/icons/folder";
import Hand from "lucide-solid/icons/hand";
import Sparkles from "lucide-solid/icons/sparkles";
import UserRound from "lucide-solid/icons/user-round";
import { createEffect, createSignal, For, type JSX, Show } from "solid-js";
import { WeeksAhead } from "./Ahead.tsx";
import { ProjectRow, shortDay, TaskRow } from "./AttentionRows.tsx";
import { followAttentionView } from "./attention-read.ts";
import { todayIn } from "./days.tsx";
import { PeerBody } from "./design/Peer.tsx";
import { SectionTitle } from "./design/SectionTitle.tsx";
import { HeldChangeItem, heldAnchor, useHeldChanges } from "./HeldChanges.tsx";
import { Inspector, type Page, type Said } from "./Inspector.tsx";
import { StandingNotices } from "./Notices.tsx";
import { contextCopy, readingCopy } from "./offline-copy.ts";
import { unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { RefusedWrites, refusedIn } from "./Unsent.tsx";

/**
 * What the Attention column holds: the standing Notices, the Held Changes left for the
 * person's tap, then the sections of `view_attention`, in their order (section 8.3). It has no
 * composer. A Task is finished from its row, and a Task or Project opened from its row onto its
 * page, over the column, where everything it has is changed.
 * Its sections are derived on the server from the whole Context, so any change to a Task, a
 * Project or the Context's settings is answered by reading the view again.
 */
export function Attention(props: {
  timeZone: string;
  /** The Due section's count, each time the view is read. */
  onDueCount: (count: number) => void;
}) {
  const contextId = useContextId();
  const callTool = useCallTool();
  const heldChanges = useHeldChanges();
  // A Task finished Unsent leaves Attention at once, before the server has heard (section 8.8).
  const { view, problem, setProblem, read } = followAttentionView({
    tool: "view_attention",
    without: withoutUnsentFinishes,
    // With no network, Attention is shown as the Offline Copy last fetched it (section 8.8).
    offline: () => contextCopy(contextId)?.attention ?? null,
    onShown: (offline) => readingCopy(contextId, offline),
  });
  createEffect(() => {
    const shown = view();
    if (shown) props.onDueCount(shown.due.length);
  });
  // The weeks ahead, opened from the Due section and shown under it (section 8.3).
  const [aheadOpen, setAheadOpen] = createSignal(false);
  // What the last change made from a page said, once what it changed has left Attention, and how
  // to undo it where it can be: a Project moved (section 3.9), a Task or Project at an end or in
  // the Trash, a Task left waiting.
  const [said, setSaid] = createSignal<Said | null>(null);
  // The pages open over the column, the first opened from a row; none while it is shut.
  const [pages, setPages] = createSignal<Page[]>([]);
  // The row the panel was opened from, which the focus goes back to.
  let openedFrom: string | null = null;
  let list: HTMLDivElement | undefined;
  createEffect(() => {
    if (list) list.inert = pages().length > 0;
  });

  /** Why and when a Task came up, said first on its row. */
  function cameUpSaid(came: CameUp): string {
    const today = todayIn(props.timeZone);
    const on =
      came.because === "defer_date_came" ? came.on : dayIn(Date.parse(came.at), props.timeZone);
    const why =
      came.because === "defer_date_came"
        ? "Defer Date came"
        : came.because === "taken_back"
          ? "Taken back"
          : "Wait ended";
    return `${why} ${shortDay(on, today)}`;
  }

  // What the status line says stays until another change replaces it, so its Reopen or Restore
  // can still be reached after a row is opened.
  function open(page: Page, key: string) {
    if (pages().length === 0) openedFrom = key;
    setPages([page]);
  }

  /**
   * The page shut: the focus goes back to the row it was opened from, or to what the status line
   * offers when that row has left. A change made on the page is read first, since reading it
   * draws the rows afresh and would take the focus from one given it before.
   */
  function closed() {
    const key = openedFrom;
    openedFrom = null;
    const focusRow = () => {
      const row = key && list?.querySelector<HTMLElement>(`[data-open-key="${key}"]`);
      (row || list?.querySelector<HTMLElement>(".moved button") || list)?.focus();
    };
    queueMicrotask(focusRow);
    void read().then(() => {
      // Only where the focus was lost with the row drawn afresh: the person may have moved on.
      const at = document.activeElement;
      if (at === document.body || at === list) focusRow();
    });
  }

  async function undo(shown: Said) {
    if (!shown.undo) return;
    try {
      const refused = await shown.undo.run(callTool);
      if (refused !== null) return setProblem(refused);
      // Only what it undid goes from the status line: a change said meanwhile stays said.
      if (said() === shown) setSaid(null);
      await read();
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  }

  const taskRow = (task: Task, place?: string) => (
    <TaskRow
      task={task}
      timeZone={props.timeZone}
      place={place}
      openKey={`task-${task.id}`}
      onOpen={() => open({ kind: "task", id: task.id, held: task }, `task-${task.id}`)}
      onTask={() => void read()}
      onProblem={setProblem}
    />
  );

  return (
    <PeerBody class="attention-body">
      <div ref={list} class="attention-list" tabIndex={-1}>
        {/* What this Device sent and the server did not accept comes first (section 8.3). */}
        <RefusedWrites context={contextId} />
        {/* Standing Notices sit above the sections of the view, and are not counted (section 8.3). */}
        <StandingNotices />
        <Show when={problem()}>
          {(message) => (
            <p class="problem" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={said()}>
          {(shown) => (
            <p class="moved" role="status">
              {shown().text}
              <Show when={shown().undo}>
                {(how) => (
                  <>
                    {" "}
                    <button type="button" class="quiet" onClick={() => void undo(shown())}>
                      {how().label}
                    </button>
                  </>
                )}
              </Show>
            </p>
          )}
        </Show>
        <Section id="held-changes" title="Held Changes" icon={Hand} items={heldChanges.all()}>
          {(held) => (
            <li>
              <HeldChangeItem held={held} anchor={heldAnchor(held.id)} />
            </li>
          )}
        </Section>
        <Show when={view()}>
          {(shown) => (
            <>
              <Section
                id="due"
                title="Due"
                icon={Clock}
                items={shown().due}
                shownEmpty
                aside={
                  <button
                    type="button"
                    class="quiet"
                    aria-expanded={aheadOpen()}
                    aria-controls="weeks-ahead"
                    onClick={() => setAheadOpen((open) => !open)}
                  >
                    <Calendar size={16} aria-hidden="true" />
                    The weeks ahead
                  </button>
                }
                after={
                  <Show when={aheadOpen()}>
                    <WeeksAhead id="weeks-ahead" timeZone={props.timeZone} />
                  </Show>
                }
              >
                {(item) =>
                  item.kind === "task" ? (
                    taskRow(item.task)
                  ) : (
                    <ProjectRow
                      project={item.project}
                      timeZone={props.timeZone}
                      dueListed
                      openKey={`due-project-${item.project.id}`}
                      onOpen={() =>
                        open(
                          { kind: "project", id: item.project.id, held: item.project },
                          `due-project-${item.project.id}`,
                        )
                      }
                    />
                  )
                }
              </Section>
              <Section
                id="newly-actionable"
                title="Newly actionable"
                icon={Sparkles}
                items={shown().newly_actionable}
              >
                {(item) => taskRow(item.task, cameUpSaid(item.came_up))}
              </Section>
              <Section id="delegated" title="Delegated" icon={UserRound} items={shown().delegated}>
                {(task) => taskRow(task)}
              </Section>
              <Section id="projects" title="Projects" icon={Folder} items={shown().projects}>
                {(item) => (
                  <ProjectRow
                    project={item.project}
                    timeZone={props.timeZone}
                    actionable={item.actionable_tasks}
                    noOpenTask={item.no_open_task}
                    openKey={`project-${item.project.id}`}
                    onOpen={() =>
                      open(
                        { kind: "project", id: item.project.id, held: item.project },
                        `project-${item.project.id}`,
                      )
                    }
                  />
                )}
              </Section>
              <Section id="loose" title="Loose" icon={Circle} items={shown().loose}>
                {(task) => taskRow(task)}
              </Section>
              <Show
                when={
                  heldChanges.all().length === 0 &&
                  refusedIn(contextId).length === 0 &&
                  Object.values(shown()).every((items) => items.length === 0)
                }
              >
                <p class="peer-note">Nothing is open to act on.</p>
              </Show>
            </>
          )}
        </Show>
      </div>
      <Show when={pages().length > 0}>
        <Inspector
          pages={pages()}
          setPages={setPages}
          timeZone={props.timeZone}
          projectName={(id) =>
            view()?.projects.find((item) => item.project.id === id)?.project.name
          }
          viewRead={view}
          onChanged={() => void read()}
          onSaid={setSaid}
          onClosed={closed}
        />
      </Show>
    </PeerBody>
  );
}

/** Attention as read, without the Tasks finished Unsent on this Device. */
function withoutUnsentFinishes(
  view: AttentionView,
  finishedUnsent: (task: Task) => boolean,
): AttentionView {
  const stillShown = (task: Task) => !finishedUnsent(task);
  return {
    ...view,
    due: view.due.filter((item) => item.kind !== "task" || stillShown(item.task)),
    newly_actionable: view.newly_actionable.filter((item) => stillShown(item.task)),
    delegated: view.delegated.filter(stillShown),
    projects: view.projects.map((item) => ({
      ...item,
      project: { ...item.project, tasks: item.project.tasks.filter(stillShown) },
    })),
    loose: view.loose.filter(stillShown),
  };
}

/**
 * One of Attention's sections, in the order given, shown only when it holds something unless it
 * is `shownEmpty`, as Due is for the weeks ahead it opens.
 */
function Section<T>(props: {
  id: string;
  title: string;
  /** Beside its title, as every heading of Attention carries one (section 8.11). */
  icon: LucideIcon;
  items: T[];
  shownEmpty?: boolean;
  /** Beside its title. */
  aside?: JSX.Element;
  /** Under its list. */
  after?: JSX.Element;
  children: (item: T) => JSX.Element;
}) {
  return (
    <Show when={props.shownEmpty || props.items.length > 0}>
      <section class="attention-section" aria-labelledby={`attention-${props.id}`}>
        <div class="attention-section-head">
          <SectionTitle id={`attention-${props.id}`} title={props.title} icon={props.icon} />
          {props.aside}
        </div>
        <Show when={props.items.length > 0}>
          <ul class="task-list">
            <For each={props.items}>{(item) => props.children(item)}</For>
          </ul>
        </Show>
        {props.after}
      </section>
    </Show>
  );
}
