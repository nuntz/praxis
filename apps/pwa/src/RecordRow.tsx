import type { Accent } from "@praxis/domain";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Pencil from "lucide-solid/icons/pencil";
import { createEffect, createSignal, createUniqueId, type JSX, on, onMount, Show } from "solid-js";
import { type Action, Menu } from "./design/Menu.tsx";
import { followRecord } from "./follow-record.ts";
import { MarkedLine } from "./leaving.tsx";

/**
 * A Context, a Connection or a Device in its list in Settings, drawn as a setting's row is: its
 * name as the title, a Context's beside its swatch, its details as the note, then the one act it is
 * for, and the rest behind a More button, Rename first. Rename turns the title into the name's
 * field in place, the focus in it, and the field goes, the focus back on More, once the name is
 * kept or the person leaves it with Cancel or Escape. Marked to end or retire as its section is
 * left (ADR 0028), it says so in place of its acts, beside a Keep it that takes the focus as it is
 * marked and gives it back to More.
 */
export function RecordRow(props: {
  testId: "context-row" | "connection-row" | "device-row";
  name: string;
  /** A Context's accent, drawn as its swatch beside its name. */
  accent?: Accent;
  /** Its details, as a line under its name. */
  note: JSX.Element;
  /** Under its note and its acts, across the row, as a Connection's address is. */
  detail?: JSX.Element;
  /** The one act shown, before More. */
  act?: JSX.Element;
  /** What More holds after Rename. */
  more: Action[];
  /** Under the row, across its width: what an act behind More opened, as the accents are. */
  under?: JSX.Element;
  /** Whether a change of its section is out, which holds its acts. */
  sending: boolean;
  /** Send the name typed; whether it was kept. */
  onRename: (name: string) => Promise<boolean>;
  /** Its More button, for an act opened from it to give the focus back to. */
  moreRef?: (button: HTMLButtonElement) => void;
  /** What an act marked on it will do when its section is left, and how the mark is taken off. */
  marked?: { says: string; onKeep: () => void } | undefined;
}) {
  const [renaming, setRenaming] = createSignal(false);
  const nameId = createUniqueId();
  let more: HTMLButtonElement | undefined;
  let keep: HTMLButtonElement | undefined;
  // Marked, the focus goes to its Keep it, which gives it back to More.
  createEffect(
    on(
      () => props.marked !== undefined,
      (marked) => {
        if (marked) keep?.focus();
      },
      { defer: true },
    ),
  );

  function doneRenaming() {
    setRenaming(false);
    more?.focus();
  }

  return (
    <li class="settings-row record-row" data-testid={props.testId}>
      <div class="settings-row-words">
        <Show
          when={renaming()}
          fallback={
            <span class="settings-row-title record-title">
              <Show when={props.accent}>
                {(accent) => <span class={`swatch accent-${accent()}`} aria-hidden="true" />}
              </Show>
              <span id={nameId} class="record-name">
                {props.name}
              </span>
            </span>
          }
        >
          <RenameField
            name={props.name}
            sending={props.sending}
            onRename={props.onRename}
            onDone={doneRenaming}
          />
        </Show>
        <span class="settings-row-note">{props.note}</span>
      </div>
      <div class="settings-row-control">
        <Show
          when={props.marked}
          fallback={
            <>
              {props.act}
              <Menu
                label={`More for ${props.name}`}
                icon={Ellipsis}
                buttonRef={(button) => {
                  more = button;
                  props.moreRef?.(button);
                }}
                items={[
                  {
                    label: "Rename",
                    icon: Pencil,
                    disabled: props.sending,
                    onSelect: () => setRenaming(true),
                  },
                  ...props.more,
                ]}
              />
            </>
          }
        >
          {(marked) => (
            <MarkedLine
              says={marked().says}
              of={nameId}
              onKeep={() => {
                marked().onKeep();
                more?.focus();
              }}
              keepRef={(button) => {
                keep = button;
              }}
            />
          )}
        </Show>
      </div>
      {props.detail}
      {props.under}
    </li>
  );
}

/**
 * A record's name as a field, in its title's place, the focus in it as it opens. What is typed is
 * the person's until it is sent (`followRecord`); kept, or left by Cancel or Escape, it goes.
 */
function RenameField(props: {
  name: string;
  sending: boolean;
  onRename: (name: string) => Promise<boolean>;
  onDone: () => void;
}) {
  let field!: HTMLInputElement;
  const name = followRecord(
    () => field,
    () => props.name,
  );
  onMount(() => field.select());

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    if (await name.send(() => props.onRename(field.value))) props.onDone();
  }

  return (
    <form
      class="record-rename"
      aria-label={`Rename ${props.name}`}
      onSubmit={(event) => void rename(event)}
      // Listened for on the form itself, so Escape here leaves the field and not Settings.
      on:keydown={(event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onDone();
      }}
    >
      <input
        ref={field}
        type="text"
        aria-label={`Name of ${props.name}`}
        onInput={name.typed}
        required
      />
      <span class="record-rename-acts">
        <button type="submit" class="quiet" disabled={props.sending}>
          Rename
        </button>
        <button type="button" class="quiet" onClick={() => props.onDone()}>
          Cancel
        </button>
      </span>
    </form>
  );
}
