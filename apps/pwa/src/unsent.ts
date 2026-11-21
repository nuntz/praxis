import {
  type Entry,
  inlineTasks,
  KEY_DAYS,
  type NewLink,
  type NewTask,
  type Task,
  type ToolResult,
} from "@praxis/domain";
import { createSignal } from "solid-js";
import { online } from "./online.ts";
import { contextTools, SignInLapsed, signInLapsed, Unreachable } from "./tools.ts";

// The two writes the Device takes with no network (section 8.8, ADR 0020): recording an Entry and
// finishing a Task. Each stays Unsent on this Device, in its storage, until Praxis receives it.
// The server judges it on arrival under the ordinary rules: the Device works out no Effect.

/** What every Unsent write carries: the Context it is for, a key, and when it was made. */
type UnsentFields = {
  /** The Device's own id for it, by which the screen changes or discards it. */
  id: string;
  /** The Context it is for: the one shown when it was made. */
  context: string;
  /** The write's key, so one sent twice is made once (section 4.5). */
  key: string;
  /**
   * When the key was made, as an ISO 8601 instant: the server remembers it for 30 days, after which
   * a write sent with it could be made twice. Sending a refused write again makes a new key.
   */
  keyed_at: string;
  /** When it was made, as an ISO 8601 instant: the Entry's time, the Task's closing day. */
  made_at: string;
  /**
   * The server's reason, once it refused the write, or the Device's, once its key was too old to
   * send it by itself. It is then never sent again by itself (section 8.8).
   */
  refused: string | null;
};

/**
 * An Entry recorded Unsent. With no Offline Copy it is its words and Inline Tasks only (section
 * 8.8): the Device holds no record to link to or follow up.
 */
export type UnsentEntry = UnsentFields & { kind: "entry"; words: string; tasks: NewTask[] };

/** A Task finished Unsent, with what the screen shows of it until it is sent. */
export type UnsentFinish = UnsentFields & {
  kind: "finish";
  task: { id: string; title: string };
};

export type Unsent = UnsentEntry | UnsentFinish;

/** Where this browser keeps its Unsent writes, in the order made. They need no record. */
const STORAGE_KEY = "praxis.unsent";

function load(): Unsent[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Unsent[]) : [];
  } catch {
    return [];
  }
}

const [all, setAll] = createSignal<Unsent[]>(load());

/** Every Unsent write on this Device, in the order made, refused ones among them. */
export { all as unsent };

/**
 * Store the writes as they now are. Without storage they still live while Praxis is open: the
 * browser would not promise to keep them anyway, which the screen says (`storagePromised`).
 */
function save(writes: Unsent[]): void {
  setAll(writes);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(writes));
  } catch {
    setStoragePromised(false);
  }
}

function update(id: string, change: (write: Unsent) => Unsent | null): void {
  save(
    all().flatMap((write) => {
      if (write.id !== id) return [write];
      const changed = change(write);
      return changed ? [changed] : [];
    }),
  );
}

// Another window of Praxis on this Device changed them.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) setAll(load());
  });
}

/**
 * Whether the browser has promised to keep this Device's storage for good: null until asked. Praxis
 * asks once it holds an Unsent write, and says so beside the count where the browser will not.
 */
const [storagePromised, setStoragePromised] = createSignal<boolean | null>(null);

export { storagePromised };

async function askToKeepStorage(): Promise<void> {
  if (storagePromised() !== null) return;
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return void setStoragePromised(false);
    setStoragePromised((await storage.persisted()) || (await storage.persist()));
  } catch {
    setStoragePromised(false);
  }
}

/** Whether a write is to be sent: one refused, or too old to send by itself, is the person's. */
export function toSend(write: Unsent): boolean {
  return write.refused === null;
}

/** The write being sent now, which the person cannot change until its answer is in. */
const [beingSent, setBeingSent] = createSignal<string | null>(null);

export { beingSent };

/** How long a key is remembered: a write keyed earlier is not sent by itself (section 8.8). */
const KEY_REMEMBERED = KEY_DAYS * 24 * 60 * 60 * 1000;

const TOO_OLD = `It was made more than ${KEY_DAYS} days ago, so Praxis can no longer tell whether it was already received. It was not sent.`;

/** What a sent write gave back, heard by whatever shows its Context. */
export type Sent =
  | { kind: "entry"; context: string; entry: Entry }
  | { kind: "finish"; context: string; task: Task };

const sentListeners = new Set<(sent: Sent) => void>();

/** Hear each Unsent write as the server accepts it. Returns how to stop. */
export function onSent(listener: (sent: Sent) => void): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

/**
 * What became of a write made now: made, refused at once, or kept Unsent, with whether anything it
 * was given was left off for that.
 */
export type Outcome<T> =
  | { kind: "made"; value: T }
  | { kind: "unsent"; leftOff: boolean }
  | { kind: "refused"; message: string };

/**
 * Make a write: sent at once while the Device has the network and nothing Unsent is to be sent
 * ahead of it, so writes are sent in the order made, and otherwise, or when the network fails or
 * the sign-in has lapsed on the way, kept Unsent with the time it was made. Its key goes with it
 * either way, so a write whose answer was lost is made once when it is sent again. A refusal at
 * once is the screen's to show, as any write's is.
 */
async function make<T>(
  write: Unsent,
  sendAtOnce: (key: string) => Promise<ToolResult<{ record: T }>>,
  leftOff: boolean,
): Promise<Outcome<T>> {
  if (online() && !signInLapsed() && !all().some(toSend)) {
    try {
      // Sent at once, it is made when it arrives: the Device's clock is never set against it.
      const result = await sendAtOnce(write.key);
      if (result.ok) return { kind: "made", value: result.value.record };
      return { kind: "refused", message: result.error.message };
    } catch (error) {
      if (!(error instanceof Unreachable || error instanceof SignInLapsed)) throw error;
      if (error instanceof Unreachable) retryLater();
    }
  }
  save([...all(), write]);
  void askToKeepStorage();
  return { kind: "unsent", leftOff };
}

/** What a new Unsent write starts with. */
function newUnsent(context: string): UnsentFields {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    context,
    key: crypto.randomUUID(),
    keyed_at: now,
    made_at: now,
    refused: null,
  };
}

/**
 * Record an Entry in a Context, Unsent if need be. Sent at once it takes its links and the Entry it
 * follows up; kept Unsent it is its words and Inline Tasks only, and says when it left any off.
 */
export function recordEntry(
  context: string,
  entry: { words: string; links: NewLink[]; follow_up_to: string | null },
): Promise<Outcome<Entry>> {
  const tasks = inlineTasks(entry.words);
  const write: UnsentEntry = { ...newUnsent(context), kind: "entry", words: entry.words, tasks };
  const leftOff = entry.links.length > 0 || entry.follow_up_to !== null;
  return make(
    write,
    (key) =>
      contextTools(context)("record_entry", {
        words: entry.words,
        tasks,
        links: entry.links,
        ...(entry.follow_up_to ? { follow_up_to: entry.follow_up_to } : {}),
        key,
      }),
    leftOff,
  );
}

/** Finish a Task in a Context, Unsent if need be. */
export function finishTask(
  context: string,
  task: { id: string; title: string },
): Promise<Outcome<Task>> {
  const write: UnsentFinish = {
    ...newUnsent(context),
    kind: "finish",
    task: { id: task.id, title: task.title },
  };
  return make(write, (key) => contextTools(context)("finish_task", { id: task.id, key }), false);
}

/** An Unsent Entry with these words, and the Inline Tasks they hold. */
function withWords(write: Unsent, words: string): Unsent {
  return write.kind === "entry" ? { ...write, words, tasks: inlineTasks(words) } : write;
}

/** Change an Unsent Entry's words, and its Inline Tasks with them, leaving no trace. */
export function editUnsent(id: string, words: string): void {
  update(id, (write) => withWords(write, words));
}

/** Discard an Unsent write, or undo an Unsent finish, or dismiss a refused one: no trace is left. */
export function discardUnsent(id: string): void {
  update(id, () => null);
}

/**
 * Send a refused Entry again, with these words. It takes a new key, since the server remembers the
 * refusal under the old one, and keeps the time it was made.
 */
export function sendAgain(id: string, words: string): void {
  update(id, (write) => ({
    ...withWords(write, words),
    key: crypto.randomUUID(),
    keyed_at: new Date().toISOString(),
    refused: null,
  }));
  void sendUnsent();
}

/** The finish of a Task kept Unsent and still to be sent, if there is one. */
export function unsentFinishOf(task: string): UnsentFinish | null {
  return (
    all().find(
      (write): write is UnsentFinish =>
        write.kind === "finish" && write.task.id === task && toSend(write),
    ) ?? null
  );
}

let sending = false;

/**
 * Send what is to be sent, one at a time in the order made, while Praxis is open and has the
 * network (section 8.8). A refusal is kept with the server's reason, and the rest go on, since no
 * Unsent write depends on another. A network failure stops it, to be tried again; a lapsed sign-in
 * too, until the person signs in again.
 */
export async function sendUnsent(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (;;) {
      if (!online() || signInLapsed()) return;
      const next = all().find(toSend);
      if (!next) return;
      if (Date.now() - Date.parse(next.keyed_at) > KEY_REMEMBERED) {
        update(next.id, (write) => ({ ...write, refused: TOO_OLD }));
        continue;
      }
      // The person cannot change it while it is out, so what was sent is what the answer is to.
      setBeingSent(next.id);
      let result: ToolResult<{ record: Entry | Task }>;
      try {
        result = await sendOne(next);
      } catch (error) {
        // A lapsed sign-in waits for the person to sign in again, which opens Praxis afresh.
        if (error instanceof SignInLapsed) return;
        if (error instanceof Unreachable) return retryLater();
        throw error;
      } finally {
        setBeingSent(null);
      }
      pause = FIRST_PAUSE;
      if (!result.ok) {
        const reason = result.error.message;
        update(next.id, (write) => ({ ...write, refused: reason }));
        continue;
      }
      // Shown as accepted before it leaves the Device, so it is never shown as neither.
      const sent: Sent =
        next.kind === "entry"
          ? { kind: "entry", context: next.context, entry: result.value.record as Entry }
          : { kind: "finish", context: next.context, task: result.value.record as Task };
      for (const listener of sentListeners) listener(sent);
      discardUnsent(next.id);
    }
  } finally {
    sending = false;
  }
}

/** One Unsent write, sent as it was made, with its key and its time. */
function sendOne(write: Unsent): Promise<ToolResult<{ record: Entry | Task }>> {
  const tools = contextTools(write.context);
  const { key, made_at } = write;
  if (write.kind === "finish") return tools("finish_task", { id: write.task.id, key, made_at });
  return tools("record_entry", { words: write.words, tasks: write.tasks, key, made_at });
}

/** How long after a network failure what is to be sent is tried again: it doubles each time. */
const FIRST_PAUSE = 2000;
const LONGEST_PAUSE = 60_000;
let pause = FIRST_PAUSE;
let retry: ReturnType<typeof setTimeout> | null = null;

/**
 * Try again after a network failure, a little later each time, since the Device may still say it
 * has the network when it cannot reach Praxis. One with no network waits to be back online.
 */
function retryLater(): void {
  if (retry !== null) return;
  retry = setTimeout(() => {
    retry = null;
    void sendUnsent();
  }, pause);
  pause = Math.min(pause * 2, LONGEST_PAUSE);
}

/**
 * Send what is to be sent now and whenever the Device may have the network again: coming back
 * online or into view. Returns how to stop.
 */
export function keepSending(): () => void {
  const send = () => void sendUnsent();
  const onVisible = () => {
    if (document.visibilityState === "visible") send();
  };
  window.addEventListener("online", send);
  document.addEventListener("visibilitychange", onVisible);
  if (all().length > 0) void askToKeepStorage();
  send();
  return () => {
    window.removeEventListener("online", send);
    document.removeEventListener("visibilitychange", onVisible);
    if (retry !== null) clearTimeout(retry);
    retry = null;
  };
}
