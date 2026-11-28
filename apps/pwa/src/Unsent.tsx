import Pencil from "lucide-solid/icons/pencil";
import Trash from "lucide-solid/icons/trash";
import { createSignal, For, Show } from "solid-js";
import { SectionTitle } from "./design/SectionTitle.tsx";
import { deviceTimeZone } from "./device.ts";
import { EntryActions } from "./EntryActions.tsx";
import { clearCopy, clearing, copyFetchedAt } from "./offline-copy.ts";
import { online } from "./online.ts";
import type { Unsent, UnsentEntry } from "./stored.ts";
import {
  beingSent,
  discardUnsent,
  discardUnsentWrites,
  editUnsent,
  sendAgain,
  storagePromised,
  toSend,
  unsent,
} from "./unsent.ts";
import { Words } from "./Words.tsx";

// How the screen shows Unsent writes (section 8.8): an Unsent Entry in the Journal where it will
// go, the refused ones at the top of Attention, and their count under the top bar.

/** The Contexts the screen can show, once listed: a write for any other has nowhere else to go. */
const [shownContexts, setShownContexts] = createSignal<string[] | null>(null);

/** Tell what is shown of Unsent writes which Contexts can be shown, as last listed. */
export function knowShownContexts(ids: string[]): void {
  setShownContexts(ids);
}

/**
 * The Unsent writes the server did not accept, for this Context's Attention: the first of its
 * sources (section 8.3). One for a Context that can no longer be shown, retired or deleted since,
 * is put to the person in whichever is, so it is never left where nobody can deal with it.
 */
export function refusedIn(context: string): Unsent[] {
  const shown = shownContexts();
  return unsent().filter(
    (write) =>
      !toSend(write) &&
      (write.context === context || (shown !== null && !shown.includes(write.context))),
  );
}

/** The Unsent Entries to be sent in a Context, which the Journal shows where they go. */
export function unsentEntriesIn(context: string): UnsentEntry[] {
  return unsent().filter(
    (write): write is UnsentEntry =>
      write.kind === "entry" && write.context === context && toSend(write),
  );
}

/**
 * The count of Unsent writes still to be sent from this Device, whenever there is one, and where the browser will not
 * promise to keep its storage, that it may not. With no network, that only these two writes work.
 */
export function UnsentStatus() {
  // Those refused are counted in Attention, with what else is there to act on.
  const count = () => unsent().filter(toSend).length;
  return (
    <>
      <Show when={!online()}>
        <p class="screen-status" role="status">
          No network: recording an Entry and finishing a Task still work, and are sent once it is
          back. Everything else needs the network.
        </p>
      </Show>
      <Show when={copyFetchedAt()}>
        {(fetched) => (
          <p class="screen-status" role="status">
            Shown from the Offline Copy, as fetched{" "}
            <time datetime={fetched()}>{fetchedAt(fetched())}</time>.
          </p>
        )}
      </Show>
      <Show when={count() > 0}>
        <p class="screen-status unsent-count" role="status">
          {count()} Unsent
          <Show when={storagePromised() === false}>
            <span class="unsent-unkept">
              , kept on this Device only: this browser may clear them
            </span>
          </Show>
        </p>
      </Show>
    </>
  );
}

/** When the Offline Copy was fetched, in the Device's own zone and locale. */
function fetchedAt(at: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: deviceTimeZone(),
  }).format(new Date(at));
}

/** What the person is asked about the Unsent writes kept beside an Offline Copy to be cleared. */
export function unsentKeptQuestion(count: number): string {
  const [are, them] = count === 1 ? ["write is", "it"] : ["writes are", "them"];
  return `${count} Unsent ${are} kept here too: keep ${them} to be sent, or discard ${them} with the copy?`;
}

/**
 * The Offline Copy is to be cleared, as it was switched off for this Device elsewhere or the Device
 * removed, and this Device holds Unsent writes: the person is asked first whether they are kept, to
 * be sent, or discarded with it (section 8.8). Either way the copy is cleared.
 */
export function ClearingCopy() {
  return (
    <Show when={clearing() === "elsewhere"}>
      <section class="screen-status clearing-copy" aria-labelledby="clearing-copy-heading">
        <h2 id="clearing-copy-heading" class="not-accepted-title">
          The Offline Copy was switched off for this Device
        </h2>
        <p>It is cleared from this browser. {unsentKeptQuestion(unsent().length)}</p>
        <div class="held-change-actions">
          <button type="button" onClick={() => clearCopy()}>
            Keep Unsent writes
          </button>
          <button
            type="button"
            class="quiet"
            onClick={() => {
              discardUnsentWrites(unsent().map((write) => write.id));
              clearCopy();
            }}
          >
            Discard them too
          </button>
        </div>
      </section>
    </Show>
  );
}

/**
 * An Entry recorded Unsent, in the Journal where it will go. Its Inline Tasks are part of its words
 * and not yet Tasks, and nothing that would follow is shown. It is the person's to edit or discard.
 */
export function UnsentEntryItem(props: { write: UnsentEntry; formatTime: (at: string) => string }) {
  const [editing, setEditing] = createSignal(false);
  // Out to the server, it is no longer the person's to change: the answer is to what was sent.
  const out = () => beingSent() === props.write.id;
  return (
    <li class="entry unsent" data-testid="unsent-entry">
      <div class="entry-head">
        <time class="entry-time" datetime={props.write.made_at}>
          {props.formatTime(props.write.made_at)}
        </time>
        <span class="entry-mark unsent-mark">Unsent</span>
        <EntryActions
          frequent={
            editing()
              ? []
              : [{ label: "Edit", icon: Pencil, disabled: out(), onSelect: () => setEditing(true) }]
          }
          rest={[
            {
              label: "Discard",
              icon: Trash,
              disabled: out(),
              onSelect: () => discardUnsent(props.write.id),
            },
          ]}
        />
      </div>
      <Show when={props.write.follow_up_to}>
        {(to) => <p class="entry-follows">Follows up “{to().summary}”</p>}
      </Show>
      <Show
        when={editing()}
        fallback={
          <Words
            words={props.write.words}
            images={online() ? "by_itself" : "never"}
            testId="words"
          />
        }
      >
        <UnsentEditor
          id={`unsent-${props.write.id}`}
          words={props.write.words}
          action="Save"
          busy={out()}
          onDone={(words) => {
            editUnsent(props.write.id, words);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Show>
      <Show when={props.write.links.length > 0}>
        <ul class="link-list" aria-label="Mentions and References">
          <For each={props.write.links}>
            {(link) => (
              <li class={`link ${link.to.kind === "person" ? "mention" : "reference"}`}>
                {link.to.kind === "person" ? "@" : "#"}
                {link.to.summary}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/** An Unsent Entry's words as typed, to change before it is sent. */
function UnsentEditor(props: {
  id: string;
  words: string;
  action: string;
  /** Whether it cannot be done now, as while the write is out to the server. */
  busy?: boolean;
  onDone: (words: string) => void;
  onCancel?: () => void;
}) {
  const [words, setWords] = createSignal(props.words);
  const canDo = () => !props.busy && words().trim() !== "";
  return (
    <form
      class="entry-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (canDo()) props.onDone(words());
      }}
    >
      <label class="visually-hidden" for={props.id}>
        The Entry's words
      </label>
      <textarea
        id={props.id}
        rows={Math.min(12, Math.max(3, words().split("\n").length + 1))}
        value={words()}
        onInput={(event) => setWords(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && props.onCancel) {
            event.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div class="entry-editor-actions">
        <button type="submit" disabled={!canDo()}>
          {props.action}
        </button>
        <Show when={props.onCancel}>
          {(cancel) => (
            <button type="button" class="quiet" onClick={() => cancel()()}>
              Cancel
            </button>
          )}
        </Show>
      </div>
    </form>
  );
}

/**
 * The Unsent writes the server did not accept in this Context, at the top of Attention until the
 * person deals with each: a refused Entry is edited and sent again, copied or discarded, and a
 * refused finish only dismissed. Nothing is sent again by itself.
 */
export function RefusedWrites(props: { context: string }) {
  const refused = () => refusedIn(props.context);
  return (
    <Show when={refused().length > 0}>
      <section class="attention-section" aria-labelledby="attention-not-accepted">
        <SectionTitle id="attention-not-accepted" title="Not accepted" />
        <ul class="task-list">
          <For each={refused()}>
            {(write) => (
              <li class="not-accepted">
                {write.kind === "entry" ? (
                  <RefusedEntry write={write} />
                ) : (
                  <>
                    <p class="not-accepted-title">
                      Finishing “{write.task.title}” was not accepted
                    </p>
                    <p class="not-accepted-reason">{write.refused}</p>
                    <div class="held-change-actions">
                      <button type="button" onClick={() => discardUnsent(write.id)}>
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function RefusedEntry(props: { write: UnsentEntry }) {
  const [copied, setCopied] = createSignal(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.write.words);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <p class="not-accepted-title">An Entry was not accepted</p>
      <p class="not-accepted-reason">{props.write.refused}</p>
      <UnsentEditor
        id={`refused-${props.write.id}`}
        words={props.write.words}
        action="Send again"
        onDone={(words) => sendAgain(props.write.id, words)}
      />
      <div class="held-change-actions">
        <button type="button" class="quiet" onClick={() => void copy()}>
          {copied() ? "Copied" : "Copy"}
        </button>
        <button type="button" class="quiet" onClick={() => discardUnsent(props.write.id)}>
          Discard
        </button>
      </div>
    </>
  );
}
