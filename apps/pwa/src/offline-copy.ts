import {
  type Entry,
  type LinkTarget,
  type NewLink,
  nameHolds,
  type Page,
  type Person,
  type Project,
  summarizeWords,
  type Task,
  type ToolResult,
} from "@praxis/domain";
import { createSignal } from "solid-js";
import { thisDevice } from "./device.ts";
import { online } from "./online.ts";
import {
  type ContextCopy,
  forget,
  type OfflineCopy,
  readStored,
  store,
  type UnsentFollowed,
  type UnsentLink,
} from "./stored.ts";
import { type CallTool, callDeploymentTool, contextTools, Unreachable } from "./tools.ts";

// The Offline Copy (section 8.8, ADR 0020): switched on per Device, a fixed set of each Context's
// Journal kept in the browser's storage to read with no network. For every Context not retired it
// holds what `view_attention` gives, every open Task and Project, every Person, the Standing
// Entries, the last 30 days of Entries and any older Entry this Device opened. It holds no
// Conversation text and no image: an Entry's words name an image, which is never fetched for it.
// The server holds only the switch, so a Device switched off or removed elsewhere finds out on
// its next contact, and clears its copy then, asking first about any Unsent writes.

/** Where this browser keeps its Offline Copy, while it is switched on here. */
const OFFLINE = "praxis.offline";

/** How far back the copy holds every Entry. Older ones it holds only once this Device opened them. */
const ENTRY_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const [copy, setCopy] = createSignal<OfflineCopy | null>(readStored(OFFLINE));

/** The Offline Copy this Device keeps, or null while it keeps none. */
export { copy as offlineCopy };

/** What the copy holds of one Context, or null when it holds none of it. */
export function contextCopy(context: string): ContextCopy | null {
  return copy()?.contexts.find((each) => each.id === context) ?? null;
}

/**
 * The Context whose Journal the screen reads from the copy, as no network let it be read from
 * Praxis, or null: the screen then says so, with when that Context's part was fetched. A read that
 * answers reads the Journal from Praxis again.
 */
const [fromCopy, setFromCopy] = createSignal<string | null>(null);

/** When the part of the copy the screen reads was fetched, as an ISO 8601 instant, while it does. */
export function copyFetchedAt(): string | null {
  const read = fromCopy();
  return read === null ? null : (contextCopy(read)?.fetched_at ?? null);
}

/** Whether the screen reads this Context from the copy, as no network let it be read from Praxis. */
export function readFromCopy(context: string): boolean {
  return fromCopy() === context;
}

/** What a Context's screen read came from the copy, or, once a read answers, from Praxis again. */
export function readingCopy(context: string, fromIt: boolean): void {
  if (fromIt) setFromCopy(context);
  else if (fromCopy() === context) setFromCopy(null);
}

/** Why the browser would not keep the copy, when it would not. */
const [copyProblem, setCopyProblem] = createSignal<string | null>(null);

export { copyProblem };

/** Keep the copy as it now is, or clear it. */
function keep(kept: OfflineCopy | null): void {
  setCopy(kept);
  if (kept === null) {
    forget(OFFLINE);
    return;
  }
  setCopyProblem(
    store(OFFLINE, kept)
      ? null
      : "This browser would not keep the Offline Copy: it may be more than its storage takes. It is kept while Praxis is open.",
  );
}

// Another window of Praxis on this Device changed it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === OFFLINE) setCopy(readStored(OFFLINE));
  });
}

/**
 * The copy is to be cleared, and this Device holds Unsent writes, so the person is asked first
 * whether they are kept, to be sent, or discarded with it (section 8.8). Elsewhere: it was switched
 * off from another Device, or this one removed, so it is cleared whatever the answer.
 */
const [clearing, setClearing] = createSignal<"elsewhere" | null>(null);

export { clearing };

/** Start keeping a copy here, once its switch is on: it is fetched at once. */
export async function startCopy(): Promise<void> {
  if (copy() === null) keep({ contexts: [] });
  await refreshCopy();
}

/** Clear the copy here, as the person asked or answered. The Unsent writes are theirs to keep. */
export function clearCopy(): void {
  setClearing(null);
  setFromCopy(null);
  keep(null);
}

/**
 * Keep an older Entry this Device opened in the copy, in its Context's part, so it stays readable
 * with no network (section 8.8). One from the last 30 days is held anyway.
 */
export function noteOpened(context: string, entry: Entry): void {
  const kept = copy();
  const held = contextCopy(context);
  if (!kept || !held || Date.parse(entry.at) >= Date.now() - ENTRY_DAYS * DAY) return;
  const entries = [...held.entries.filter((each) => each.id !== entry.id), entry].toSorted(
    newestFirst,
  );
  const opened = held.opened.includes(entry.id) ? held.opened : [...held.opened, entry.id];
  keep({
    ...kept,
    contexts: kept.contexts.map((each) =>
      each.id === context ? { ...each, entries, opened } : each,
    ),
  });
}

let refreshing: Promise<void> | null = null;
let again: Promise<void> | null = null;
let lastRefreshed = 0;

/** How many Contexts are fetched at once, so a fetch leaves the screen's own reads room. */
const AT_ONCE = 3;

/** How often, at most, the copy is fetched again while Praxis is open. */
const AT_MOST_EVERY = 60_000;
/** How often it is fetched again while Praxis stays open and in view. */
const EVERY = 10 * 60_000;

/**
 * Fetch the copy again if this Device keeps one: first whether its switch is still on, since it
 * may have been switched off elsewhere or the Device removed, which clears it on this contact. A
 * switch on here with nothing kept, as after the browser cleared its storage, starts one. Each
 * Context's part is kept as it is fetched, the one last shown first, with when it was; one not
 * reached stays as last fetched. Asked while a fetch is out, it fetches again once that one ends,
 * since the switch may have changed since that one asked.
 */
export function refreshCopy(): Promise<void> {
  if (refreshing === null) {
    refreshing = fetchWhole().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  again ??= refreshing.then(() => {
    again = null;
    return refreshCopy();
  });
  return again;
}

async function fetchWhole(): Promise<void> {
  const here = thisDevice();
  if (here === null || !online()) return;
  lastRefreshed = Date.now();
  try {
    const devices = await callDeploymentTool("list_devices", {});
    if (!devices.ok) return;
    const on = devices.value.items.some((device) => device.id === here && device.offline_copy);
    if (!on) {
      if (copy() !== null) clearSwitchedOff();
      return;
    }
    if (clearing() !== null) return;
    // On, with nothing kept here, as after the browser cleared its storage: a copy is started.
    if (copy() === null) keep({ contexts: [] });
    const listed = await callDeploymentTool("list_contexts", {});
    if (!listed.ok) return;
    const reachable = listed.value.items.filter((context) => !context.retired);
    // A Context retired or deleted since leaves the copy.
    const kept = copy();
    if (kept === null) return;
    keep({ contexts: kept.contexts.filter((each) => reachable.some(({ id }) => id === each.id)) });
    // The one last shown first, the one most likely read next, then the newest made.
    const shown = readStored("praxis.context");
    const order = reachable
      .map((context) => context.id)
      .toReversed()
      .toSorted((a, b) => Number(b === shown) - Number(a === shown));
    const next = () => order.shift();
    await Promise.all(
      Array.from({ length: AT_ONCE }, async () => {
        for (let id = next(); id !== undefined; id = next()) await fetchInto(id);
      }),
    );
  } catch (error) {
    // Not reached: the copy stays as last fetched.
    if (!(error instanceof Unreachable)) throw error;
  }
}

/**
 * The switch was found off: the copy is cleared at once, unless this Device holds Unsent writes,
 * when the person is asked about them first (`ClearingCopy` in Unsent.tsx asks).
 */
function clearSwitchedOff(): void {
  if (hasUnsent()) setClearing("elsewhere");
  else clearCopy();
}

/** Whether this Device holds Unsent writes, refused ones among them: set by unsent.ts. */
let hasUnsent: () => boolean = () => false;

/** Tell the copy how to know whether this Device holds Unsent writes. */
export function knowUnsent(holds: () => boolean): void {
  hasUnsent = holds;
}

/**
 * The screen shows this Context: if the copy is kept here but holds nothing of it yet, as for one
 * made since or not reached yet, its part is fetched now rather than in its turn.
 */
export function fetchIfMissing(context: string): void {
  if (copy() === null || contextCopy(context) !== null || !online()) return;
  // At most once a minute, as the whole copy is: one refused is not asked again on every change.
  if (Date.now() - (missingAsked.get(context) ?? 0) < AT_MOST_EVERY) return;
  missingAsked.set(context, Date.now());
  void fetchInto(context).catch((error) => {
    if (!(error instanceof Unreachable)) throw error;
  });
}

/** When each Context missing from the copy was last fetched for being shown. */
const missingAsked = new Map<string, number>();

/** The Contexts being fetched now: each is fetched once at a time, whoever asks. */
const beingFetched = new Set<string>();

/**
 * Fetch one Context's part and keep it, as the copy is once the answer is in: not once it was
 * cleared meanwhile, not over a part fetched later, and keeping each older Entry opened meanwhile.
 */
async function fetchInto(id: string): Promise<void> {
  if (beingFetched.has(id)) return;
  beingFetched.add(id);
  try {
    const fetched = await fetchContext(id, contextCopy(id)?.opened ?? []);
    const kept = copy();
    if (fetched === null || kept === null) return;
    const now = kept.contexts.find((each) => each.id === id);
    if (now && now.fetched_at > fetched.fetched_at) return;
    // Opened while the fetch was out, an older Entry stays, as noteOpened kept it.
    const openedMeanwhile = (now?.opened ?? []).filter((each) => !fetched.opened.includes(each));
    const entries = [
      ...fetched.entries,
      ...(now?.entries ?? []).filter((entry) => openedMeanwhile.includes(entry.id)),
    ].toSorted(newestFirst);
    const part = { ...fetched, entries, opened: [...fetched.opened, ...openedMeanwhile] };
    keep({ contexts: [...kept.contexts.filter((each) => each.id !== id), part] });
  } finally {
    beingFetched.delete(id);
  }
}

/** Every page of a list, or null when one is refused. */
async function everyPage<T>(
  read: (cursor: string | undefined) => Promise<ToolResult<Page<T>>>,
  enough: (items: T[]) => boolean = () => false,
): Promise<T[] | null> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await read(cursor);
    if (!page.ok) return null;
    all.push(...page.value.items);
    if (page.value.next_cursor === null || enough(page.value.items)) return all;
    cursor = page.value.next_cursor;
  }
}

/** What the copy holds of one Context, read afresh, or null when a read is refused. */
async function fetchContext(id: string, opened: string[]): Promise<ContextCopy | null> {
  const tools: CallTool = contextTools(id);
  const fetched_at = new Date().toISOString();
  const from = Date.now() - ENTRY_DAYS * DAY;
  const recent = (entry: Entry) => Date.parse(entry.at) >= from;
  const [settings, attention, tasks, projects, persons, standing, listed] = await Promise.all([
    tools("get_settings", {}),
    tools("view_attention", {}),
    everyPage<Task>((cursor) => tools("list_tasks", cursor ? { cursor } : {})),
    everyPage<Project>((cursor) =>
      tools("list_projects", { state: "open", ...(cursor ? { cursor } : {}) }),
    ),
    everyPage<Person>((cursor) => tools("list_persons", cursor ? { cursor } : {})),
    everyPage<Entry>((cursor) =>
      tools("list_entries", { standing: true, ...(cursor ? { cursor } : {}) }),
    ),
    // Newest first: once a page reaches past 30 days, the rest are older still.
    everyPage<Entry>(
      (cursor) => tools("list_entries", cursor ? { cursor } : {}),
      (page) => page.some((entry) => !recent(entry)),
    ),
  ]);
  if (!settings.ok || !attention.ok) return null;
  if (!tasks || !projects || !persons || !standing || !listed) return null;
  const entries = listed.filter(recent);
  // An older Entry opened here is read again, and leaves the copy once it is gone.
  const stillOpened: string[] = [];
  for (const entry of opened) {
    if (entries.some((each) => each.id === entry)) continue;
    const read = await tools("get_entry", { id: entry });
    if (read.ok) {
      entries.push(read.value);
      stillOpened.push(entry);
    } else if (read.error.code !== "not_found") return null;
  }
  return {
    id,
    fetched_at,
    time_zone: settings.value.time_zone,
    attention: attention.value,
    tasks: tasks.filter((task) => task.state.is === "open"),
    projects,
    persons,
    standing,
    entries: entries.toSorted(newestFirst),
    opened: stillOpened,
  };
}

function newestFirst(a: Entry, b: Entry): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

/**
 * Keep the copy fresh while Praxis is open: fetched on opening, when the network is back, when
 * Praxis comes into view, and every ten minutes while it stays open, at most once a minute.
 * Returns how to stop.
 */
export function keepCopyFresh(): () => void {
  const fetch = () => {
    if (Date.now() - lastRefreshed >= AT_MOST_EVERY) void refreshCopy();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") fetch();
  };
  window.addEventListener("online", fetch);
  document.addEventListener("visibilitychange", onVisible);
  const every = setInterval(fetch, EVERY);
  void refreshCopy();
  return () => {
    window.removeEventListener("online", fetch);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(every);
  };
}

/** The Persons the copy holds of a Context whose names hold what was typed, as a picker narrows. */
export function personsHeld(context: string, typed: string): Person[] {
  return (contextCopy(context)?.persons ?? []).filter((person) => nameHolds(person.name, typed));
}

/** The open Projects and Tasks the copy holds of a Context whose names hold what was typed. */
export function referencesHeld(
  context: string,
  typed: string,
): { projects: Project[]; tasks: Task[] } {
  const held = contextCopy(context);
  return {
    projects: (held?.projects ?? []).filter((project) => nameHolds(project.name, typed)),
    tasks: (held?.tasks ?? []).filter((task) => nameHolds(task.title, typed)),
  };
}

/** The summary of a record the copy holds of a Context, by what a link names, or null. */
function summaryHeld(context: string, to: LinkTarget): string | null {
  const held = contextCopy(context);
  if (!held) return null;
  if (to.kind === "person") return held.persons.find((one) => one.id === to.id)?.name ?? null;
  if (to.kind === "project") return held.projects.find((one) => one.id === to.id)?.name ?? null;
  const tasks = [
    ...held.tasks,
    ...held.entries.flatMap((entry) => entry.tasks),
    ...held.projects.flatMap((project) => project.tasks),
  ];
  return tasks.find((one) => one.id === to.id)?.title ?? null;
}

/**
 * What an Entry kept Unsent may take of what the person gave it (section 8.8): a link to a record
 * the copy holds, and a Follow-up to an Entry it holds. Never a new Person or Project, since the
 * Device cannot tell whether one of that name exists, and nothing at all with no copy.
 */
export function heldForUnsent(
  context: string,
  given: { links: NewLink[]; follow_up_to: string | null },
): { links: UnsentLink[]; follow_up_to: UnsentFollowed | null; leftOff: boolean } {
  const links = given.links.flatMap((link): UnsentLink[] => {
    const to = link.to;
    // A new Person or Project names no record: the Device cannot make one.
    if (!("id" in to)) return [];
    const summary = summaryHeld(context, to);
    return summary === null
      ? []
      : [{ to: { kind: to.kind, id: to.id, summary }, anchor: link.anchor ?? null }];
  });
  const held = contextCopy(context);
  const entry =
    given.follow_up_to === null
      ? null
      : ([...(held?.entries ?? []), ...(held?.standing ?? [])].find(
          (each) => each.id === given.follow_up_to,
        ) ?? null);
  const follow_up_to = entry && { id: entry.id, summary: summarizeWords(entry.words) };
  const leftOff = links.length < given.links.length || (given.follow_up_to !== null && !entry);
  return { links, follow_up_to, leftOff };
}
