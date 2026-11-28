import type { ToolResult } from "@praxis/domain";
import { createContext, createSignal, type JSX, Show, useContext } from "solid-js";
import type { Section } from "./place.ts";
import { unreachableMessage } from "./tools.ts";

/** The section Settings shows, as its shell is given it: its address, its name, its heading. */
export const ShownSection = createContext<{
  section: Section;
  name: string;
  /** The heading drawn, which takes the focus as the section opens (section 8.6). */
  heading: (heading: HTMLHeadingElement) => void;
}>();

/**
 * A section of Settings as the screen shows it (section 8.6): a region named by its heading, the
 * section's name, which takes the focus as it opens, then the one note of a sentence or two that
 * says what it is for, then what it holds.
 */
export function SettingsSection(props: { note?: JSX.Element; children?: JSX.Element }) {
  const shown = useContext(ShownSection);
  if (!shown) throw new Error("A section shown outside Settings");
  const headingId = `${shown.section}-heading`;
  return (
    <section id={shown.section} class="settings" aria-labelledby={headingId}>
      <h2 ref={shown.heading} id={headingId} class="column-heading" tabIndex={-1}>
        {shown.name}
      </h2>
      <Show when={props.note}>
        <p class="settings-note">{props.note}</p>
      </Show>
      {props.children}
    </section>
  );
}

/**
 * A section's changes as they are sent (CODING_STANDARDS.md, Reads and changes): whether one is
 * out, the problem the last one met and where it came from, and a way to send one. A section
 * makes one queue, whichever tools its changes call, and gives it to each of its parts.
 */
export function sectionChanges() {
  const [holding, setHolding] = createSignal(0);
  const [problem, setProblem] = createSignal<{ at: string; message: string } | null>(null);
  let queued: Promise<unknown> = Promise.resolve();

  /**
   * A change, sent once every change before it is answered, so they land in the order they were
   * made, and `send` reads the state as the ones before it left it. One made by a control holds
   * the others while it is out (`holds`). One sent as its field is left holds nothing: the press
   * that left it lands as meant, and its change waits behind the field's. It answers with what the
   * tool gave, or null once a refusal or an outage is said at `at`, the group it came from; one
   * that goes through clears what was said.
   */
  function change<T>(
    at: string,
    send: () => Promise<ToolResult<T>>,
    { holds = true } = {},
  ): Promise<T | null> {
    if (holds) setHolding((count) => count + 1);
    const sent = queued
      .then(() => sendNow(at, send))
      .finally(() => {
        if (holds) setHolding((count) => count - 1);
      });
    // A fault thrown on leaves the changes behind it to go.
    queued = sent.catch(() => {});
    return sent;
  }

  async function sendNow<T>(at: string, send: () => Promise<ToolResult<T>>): Promise<T | null> {
    try {
      const result = await send();
      if (!result.ok) {
        setProblem({ at, message: result.error.message });
        return null;
      }
      setProblem(null);
      return result.value;
    } catch (error) {
      setProblem({ at, message: unreachableMessage(error) });
      return null;
    }
  }

  return {
    change,
    /** Whether a change that holds the section's controls is out. */
    sending: () => holding() > 0,
    /** What went wrong with the last change, if it came from `at`. */
    problemAt: (at: string) => {
      const said = problem();
      return said?.at === at ? said.message : null;
    },
    /** Say a problem at `at` that no tool answered, such as a field that holds no amount. */
    say: (at: string, message: string) => setProblem({ at, message }),
    /** Take back what was said at `at`, as a field that now holds what it should. */
    unsay: (at: string) => {
      if (problem()?.at === at) setProblem(null);
    },
  };
}

export type SectionChanges = ReturnType<typeof sectionChanges>;

/** A count as the phone's list of sections shows it: only above zero (section 8.6). */
export function listedCount(held: number): string {
  return held > 0 ? String(held) : "";
}
