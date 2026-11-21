import type { Change, ChangesPage, LiveMessage, Message, ToolResult } from "@praxis/domain";

/** What hears what the live channel brings, to patch what it shows from it. */
export type LiveListener = {
  /** A change in the Context, as `list_changes` gives it. Waited on before the next. */
  changed?(change: Change): Promise<void> | void;
  /** Some changes are gone from the log while the channel was down: read what is shown afresh. */
  readAfresh?(): Promise<void> | void;
  /** The Agent's answer being written: all of it so far. */
  answer?(words: string): void;
  /** A Message now whole in the Conversation, to place by its id. */
  message?(message: Message): void;
  /** A Message no longer in the Conversation, by its id: a Brief or Review a newer one replaced. */
  gone?(message: string): void;
  /** The Conversation was cleared: it holds no Message now. */
  cleared?(): void;
  /**
   * The channel opened again after a drop. What the Conversation said meanwhile is not replayed:
   * read it with `list_messages`.
   */
  rejoined?(): Promise<void> | void;
};

/** Opens one live channel, telling `on` what it carries and when it closes. */
export type LiveOpener = (on: { message(data: string): void; closed(): void }) => {
  close(): void;
};

export type LiveOptions = {
  open: LiveOpener;
  /** The Context's `list_changes`, to catch up from once the channel opens again. */
  listChanges: (input: { cursor?: string }) => Promise<ToolResult<ChangesPage>>;
  /** A pause before opening the channel again. */
  wait: (ms: number) => Promise<void>;
  /** Settles when the screen should wait no longer for the channel before reading. */
  readyBy?: Promise<void>;
};

/**
 * The screen's end of its current Context's live channel (section 9.5). It hands each change down
 * to its listeners one at a time, in order. Nothing goes up it.
 */
export class Live {
  readonly #listeners = new Set<LiveListener>();
  readonly #options: LiveOptions;
  /** Where the screen has heard the change log up to, once the channel has first said. */
  #cursor: string | null = null;
  /** Each message is handled after the one before it, listeners and all. */
  #queue: Promise<void> = Promise.resolve();
  /** The channel open now, or being waited for. */
  #channel: Opening;
  /** Whether the screen has left the Context, so the channel is not opened again. */
  #closed = false;
  /** How long to pause before opening the channel again: it doubles with each failure. */
  #pause = FIRST_PAUSE;
  #becomeReady: () => void = () => {};
  /** Whether the screen was let read before the channel said where the log stood. */
  #readUnheard = false;

  /**
   * Settles once the channel has first said where the change log stands, or first failed to, or
   * once `readyBy` does. What the screen reads after it misses nothing: had the channel not said
   * yet, the screen is told to read afresh when it does.
   */
  readonly ready = new Promise<void>((resolve) => {
    this.#becomeReady = resolve;
  });

  constructor(options: LiveOptions) {
    this.#options = options;
    this.#channel = this.#open();
    void options.readyBy?.then(() => this.#becomeReady());
    void this.ready.then(() => {
      if (this.#cursor === null) this.#readUnheard = true;
    });
  }

  /** Hear each change from now on. Returns how to stop. */
  listen(listener: LiveListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Close the channel for good, as the screen leaves the Context. */
  close(): void {
    this.#closed = true;
    this.#channel.ended = true;
    this.#channel.handle?.close();
  }

  /**
   * Open a dropped channel now rather than after its pause, as when the screen comes back into
   * view or the Device back online.
   */
  wake(): void {
    if (this.#closed || !this.#channel.ended) return;
    this.#channel = this.#open();
  }

  /** Open a channel. Its first message says where the change log stands. */
  #open(): Opening {
    const opening: Opening = { handle: null, ended: false };
    let first = true;
    opening.handle = this.#options.open({
      message: (data) => {
        if (opening.ended) return;
        const message = JSON.parse(data) as LiveMessage;
        const isFirst = first;
        first = false;
        if (isFirst) this.#pause = FIRST_PAUSE;
        this.#queue = this.#queue
          .then(() =>
            isFirst && message.kind === "changes"
              ? this.#opened(message.cursor)
              : this.#heard(message),
          )
          // What could not be handled is caught up on once the channel opens again.
          .catch(() => this.#drop(opening));
      },
      closed: () => this.#drop(opening),
    });
    return opening;
  }

  /** Be done with a channel, closed by either end, and open another after a pause. */
  async #drop(opening: Opening): Promise<void> {
    if (opening.ended) return;
    opening.ended = true;
    opening.handle?.close();
    this.#becomeReady();
    const pause = this.#pause;
    this.#pause = Math.min(pause * 2, LONGEST_PAUSE);
    await this.#options.wait(pause);
    // Closed for good, or woken and opened again already, in the meantime.
    if (this.#closed || this.#channel !== opening) return;
    this.#channel = this.#open();
  }

  /**
   * The channel opened at `cursor`. The first time, the screen hears from there. After a drop, it
   * catches up from `list_changes` on what it missed, or reads afresh if that is gone.
   */
  async #opened(cursor: string): Promise<void> {
    if (this.#cursor === null) {
      this.#cursor = cursor;
      this.#becomeReady();
      if (this.#readUnheard) await this.#readAfresh();
      return;
    }
    for (let more = true; more; ) {
      const result = await this.#options.listChanges({ cursor: this.#cursor });
      const afresh = !result.ok || result.value.read_afresh;
      if (afresh) {
        await this.#readAfresh();
        this.#cursor = result.ok ? result.value.cursor : cursor;
        return;
      }
      await this.#deliver(result.value.items);
      this.#cursor = result.value.cursor;
      more = result.value.more;
    }
    for (const listener of this.#listeners) await listener.rejoined?.();
  }

  async #readAfresh(): Promise<void> {
    for (const listener of this.#listeners) {
      await listener.readAfresh?.();
      await listener.rejoined?.();
    }
  }

  async #heard(message: LiveMessage): Promise<void> {
    if (message.kind === "answer") {
      for (const listener of this.#listeners) listener.answer?.(message.words);
      return;
    }
    if (message.kind === "message") {
      for (const listener of this.#listeners) listener.message?.(message.message);
      return;
    }
    if (message.kind === "gone") {
      for (const listener of this.#listeners) listener.gone?.(message.message);
      return;
    }
    if (message.kind === "cleared") {
      for (const listener of this.#listeners) listener.cleared?.();
      return;
    }
    await this.#deliver(message.items);
    this.#cursor = message.cursor;
  }

  async #deliver(changes: Change[]): Promise<void> {
    for (const change of changes) {
      for (const listener of this.#listeners) await listener.changed?.(change);
    }
  }
}

const FIRST_PAUSE = 1000;
const LONGEST_PAUSE = 30_000;

/** One opening of the channel: done with once it closes, by either end. */
type Opening = { handle: { close(): void } | null; ended: boolean };

/** Opens the live channel as a WebSocket at this address. */
export function socketOpener(address: string): LiveOpener {
  return (on) => {
    const socket = new WebSocket(address);
    socket.addEventListener("message", (event) => on.message(String(event.data)));
    // A channel that fails to open closes too, after its error.
    socket.addEventListener("close", () => on.closed());
    return { close: () => socket.close(1000, "The screen left this Context") };
  };
}
