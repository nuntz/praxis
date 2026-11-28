import { compareWords, foldUnchanged } from "@praxis/domain";
import { createMemo, createSignal, For, Match, Switch } from "solid-js";

/**
 * The words now compared with the words a tap brings, as a Version's and a Held Change's are
 * shown (sections 3.2 and 4.7), as typed and never rendered (section 8.4). What goes is struck
 * and muted, what comes is marked by weight and the accent's tint, and each says so to a screen
 * reader, which announces neither element. An unchanged stretch of more than three lines is
 * folded, and opens in place.
 */
export function Comparison(props: { now: string; brought: string }) {
  const parts = createMemo(() => foldUnchanged(compareWords(props.now, props.brought)));
  return (
    <p class="comparison" data-testid="comparison">
      <For each={parts()}>
        {(part) => (
          <Switch>
            <Match when={part.kind === "gone"}>
              <del>
                <span class="visually-hidden">removed: </span>
                {part.text}
              </del>
            </Match>
            <Match when={part.kind === "come"}>
              <ins>
                <span class="visually-hidden">added: </span>
                {part.text}
              </ins>
            </Match>
            <Match when={part.kind === "folded" && part}>
              {(folded) => <Folded text={folded().text} lines={folded().lines} />}
            </Match>
            <Match when={part.kind === "kept"}>
              <span>{part.text}</span>
            </Match>
          </Switch>
        )}
      </For>
    </p>
  );
}

/** Unchanged lines folded into one button, which opens them in place and gives them the focus. */
function Folded(props: { text: string; lines: number }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Switch>
      <Match when={open()}>
        {/* The button the focus was on is gone, so the lines it opened take the focus. */}
        <span ref={(element) => queueMicrotask(() => element.focus())} tabIndex={-1}>
          {props.text}
        </span>
      </Match>
      <Match when={!open()}>
        <button type="button" class="quiet comparison-fold" onClick={() => setOpen(true)}>
          … {props.lines} lines unchanged …
        </button>
      </Match>
    </Switch>
  );
}
