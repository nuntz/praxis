import { ACCENTS, type ContextListing, type NewTask } from "@praxis/domain";

// What the screen stores on this Device for a later load, in the browser's storage, and the only
// module that touches it (biome.json). Every later release reads it as stored here, since the
// screen that stored it may be replaced before it is read again (section 8.8, ADR 0020). So each
// key's reader checks what it finds rather than trusting it, and each shape a release stored is a
// fixture in test/stored/ that the current reader must read (CODING_STANDARDS.md, Upgrades). A
// release that changes a shape adds a fixture of the new one, and reads the earlier ones too.

/** What every Unsent write carries: the Context it is for, a key, and when it was made. */
export type UnsentFields = {
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

/** What is stored under each key, as the current screen reads it. */
type Stored = {
  /** The Unsent writes, in the order made. They need no record (section 8.8). */
  "praxis.unsent": Unsent[];
  /**
   * The Contexts last read, so Praxis opens on one with no network (section 8.8): each one's id,
   * name, accent and whether it is retired, and nothing of its Journal. Null when none are kept.
   */
  "praxis.contexts": ContextListing[] | null;
  /** The Context last shown. It needs no record on the server. */
  "praxis.context": string | null;
  /** This browser's id as a Device (section 8.10). */
  "praxis.device": string | null;
};

export type StoredKey = keyof Stored;

/** How a key's text is read, checked, and written. */
type Shape<T> = {
  /** What the text stored reads as, or what nothing stored does. It never throws. */
  read(text: string | null): T;
  /** The text to store for a value, given what is stored now. */
  write(value: NonNullable<T>, before: string | null): string;
};

/** A key that holds one string as it is, such as an id. */
const TEXT: Shape<string | null> = { read: (text) => text || null, write: (text) => text };

const SHAPES: { [K in StoredKey]: Shape<Stored[K]> } = {
  "praxis.unsent": {
    read: (text) => {
      const stored = parsed(text);
      return Array.isArray(stored) ? stored.flatMap((each) => unsentWrite(each) ?? []) : [];
    },
    // A write this screen cannot read, such as one a later release's screen open beside it
    // stored, is not shown, but it is kept: nothing is dropped silently (section 8.8).
    write: (writes, before) => {
      const stored = parsed(before);
      const unread = Array.isArray(stored) ? stored.filter((each) => !unsentWrite(each)) : [];
      return JSON.stringify([...writes, ...unread]);
    },
  },
  "praxis.contexts": {
    // Kept whole or not at all: a list missing a Context would open on the wrong one.
    read: (text) => {
      const stored = parsed(text);
      if (!Array.isArray(stored)) return null;
      const kept = stored.map(listing);
      return kept.every((each) => each !== null) ? (kept as ContextListing[]) : null;
    },
    write: (contexts) =>
      JSON.stringify(
        contexts.map(({ id, name, accent, retired }) => ({ id, name, accent, retired })),
      ),
  },
  "praxis.context": TEXT,
  "praxis.device": TEXT,
};

/** Every key the screen stores under. */
export const STORED_KEYS = Object.keys(SHAPES) as StoredKey[];

/** What is stored under a key, read and checked; without storage, as if nothing were. */
export function readStored<K extends StoredKey>(key: K): Stored[K] {
  return SHAPES[key].read(storedText(key));
}

/** Store a value under a key, saying whether the browser kept it. */
export function store<K extends StoredKey>(key: K, value: NonNullable<Stored[K]>): boolean {
  try {
    localStorage.setItem(key, SHAPES[key].write(value, storedText(key)));
    return true;
  } catch {
    return false;
  }
}

function storedText(key: StoredKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // No storage: nothing is stored.
    return null;
  }
}

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A JSON object's fields, or null for anything else. */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * An Unsent write as stored, or null for anything else. Each one is built whole, every field
 * given (`Required`), so a field a release adds, optional or not, is given a value when an earlier
 * shape is read; the current screen then stores a shape no fixture has, and test/stored.test.ts
 * fails until one is added.
 */
function unsentWrite(value: unknown): Unsent | null {
  const kept = asObject(value);
  if (!kept) return null;
  const { id, context, key, keyed_at, made_at, refused } = kept;
  if (!isText(id) || !isText(context) || !isText(key)) return null;
  if (!isText(keyed_at) || !isText(made_at)) return null;
  if (refused !== null && !isText(refused)) return null;
  const fields = { id, context, key, keyed_at, made_at, refused } satisfies Required<UnsentFields>;
  if (kept.kind === "entry") {
    const { words, tasks } = kept;
    if (!isText(words) || !Array.isArray(tasks)) return null;
    const titles = tasks.map((task) => asObject(task)?.title);
    if (!titles.every(isText)) return null;
    const read = titles.map((title) => ({ title }) satisfies Required<NewTask>);
    return { ...fields, kind: "entry", words, tasks: read } satisfies Required<UnsentEntry>;
  }
  if (kept.kind === "finish") {
    const task = asObject(kept.task);
    if (!task || !isText(task.id) || !isText(task.title)) return null;
    const read = { id: task.id, title: task.title } satisfies Required<UnsentFinish["task"]>;
    return { ...fields, kind: "finish", task: read } satisfies Required<UnsentFinish>;
  }
  return null;
}

/** A Context as stored, or null for anything else. */
function listing(value: unknown): ContextListing | null {
  const kept = asObject(value);
  if (!kept) return null;
  const { id, name, accent, retired } = kept;
  if (!isText(id) || !isText(name) || typeof retired !== "boolean") return null;
  const known = ACCENTS.find((each) => each === accent);
  return known ? { id, name, accent: known, retired } : null;
}
