import { type Entry, inlineTasksAdded, isHeld, type Task } from "@praxis/domain";
import Check from "lucide-solid/icons/check";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Plus from "lucide-solid/icons/plus";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { TaskItem } from "./TaskItem.tsx";
import { unreachableMessage, useCallTool } from "./tools.ts";

/**
 * An Entry's page, over the whole Journal column (section 8.4): its words as typed, with no toolbar
 * and no preview, saved from the page's header; its Tasks, with a field that adds one at once and
 * leaves the words alone. The change to the words is made against the version the page opened on,
 * so one made meanwhile is never overwritten: it is `stale`, and the draft stays for the person to
 * keep or drop. A marked line the words gain makes a Task, as the composer's do; one they lose
 * deletes none. Leaving with words not saved asks first.
 */
export function EntryPage(props: {
  entry: Entry;
  timeZone: string;
  /** When the Entry was made, with its day, as the page's header says it. */
  when: string;
  /** Where the caret goes on opening: the words, or the field that adds a Task. */
  start: "words" | "task";
  /** The Journal column the page is over. */
  column: HTMLElement;
  onSaved: (entry: Entry) => void;
  onTask: (task: Task) => void;
  onClose: () => void;
}) {
  const callTool = useCallTool();
  // As the page opened on it: what the change is made against, whatever comes in meanwhile.
  const opened = { words: props.entry.words, version: props.entry.version };
  const [words, setWords] = createSignal(opened.words);
  const [title, setTitle] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const changed = () => words() !== opened.words;
  const canSave = () => !saving() && changed() && words().trim() !== "";
  let field!: HTMLTextAreaElement;
  let taskField!: HTMLInputElement;
  let keep: HTMLButtonElement | undefined;

  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };

  // The column under the page is out of reach while it is open: the page is all there is.
  const under = [...props.column.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  onMount(() => {
    for (const child of under) child.inert = true;
    grow();
    if (props.start === "task") taskField.focus();
    else {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  });
  onCleanup(() => {
    for (const child of under) child.inert = false;
  });

  async function save() {
    if (!canSave()) return;
    setSaving(true);
    setProblem(null);
    try {
      const result = await callTool("edit_entry", {
        id: props.entry.id,
        words: words(),
        version: opened.version,
        tasks: inlineTasksAdded(opened.words, words()),
      });
      if (!result.ok) {
        return setProblem(
          result.error.code === "stale"
            ? "This Entry changed while you were editing it, so your edit was not saved. Your words are still here: go back and discard them to see the Entry as it is now."
            : result.error.message,
        );
      }
      // A change by the person's own hand is never held.
      if (isHeld(result.value)) throw new Error("A change by hand was held");
      props.onSaved(result.value.record);
      props.onClose();
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function addTask() {
    const named = title().trim();
    if (named === "" || adding()) return;
    setAdding(true);
    setProblem(null);
    try {
      const result = await callTool("add_task", { entry_id: props.entry.id, title: named });
      if (!result.ok) return setProblem(result.error.message);
      props.onTask(result.value.record);
      setTitle("");
      taskField.focus();
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setAdding(false);
    }
  }

  /** Back to the Journal, asking first when the words were changed and not saved. */
  function leave() {
    if (changed() && !asking()) {
      setAsking(true);
      queueMicrotask(() => keep?.focus());
      return;
    }
    props.onClose();
  }

  function keepEditing() {
    setAsking(false);
    field.focus();
  }

  return (
    <Portal mount={props.column}>
      <section
        class="entry-page"
        role="dialog"
        aria-label={`The Entry of ${props.when}`}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          if (asking()) keepEditing();
          else leave();
        }}
      >
        <header class="entry-page-head">
          <button
            type="button"
            class="entry-page-back"
            aria-label="Back to the Journal"
            onClick={leave}
          >
            <ChevronLeft size={20} aria-hidden="true" />
            <span>Journal</span>
          </button>
          <span class="entry-page-when">
            {props.when}
            <Show when={props.entry.edited}> · Edited</Show>
          </span>
          <button
            type="button"
            class="entry-page-save"
            disabled={!canSave()}
            onClick={() => void save()}
          >
            <Check size={16} aria-hidden="true" />
            Save
          </button>
        </header>
        <Show when={asking()}>
          <div class="entry-page-ask" role="alertdialog" aria-label="Your changes are not saved">
            <span class="entry-page-ask-said">Your changes to the words are not saved.</span>
            <button ref={keep} type="button" class="quiet" onClick={keepEditing}>
              Keep editing
            </button>
            <button type="button" class="entry-page-discard" onClick={() => props.onClose()}>
              Discard them
            </button>
          </div>
        </Show>
        <div class="entry-page-body">
          <Show when={problem()}>
            {(message) => (
              <p class="problem" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <label class="visually-hidden" for={`edit-${props.entry.id}`}>
            The Entry's words
          </label>
          <textarea
            ref={field}
            id={`edit-${props.entry.id}`}
            class="entry-page-words"
            value={words()}
            onInput={(event) => {
              setWords(event.currentTarget.value);
              setAsking(false);
              grow();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
              }
            }}
          />
          <p class="entry-page-hint">A line starting [] adds a Task when the words are saved.</p>
          <h3 class="entry-page-title">Its Tasks</h3>
          <ul class="task-list" aria-label="Tasks">
            <For each={props.entry.tasks}>
              {(task) => (
                <TaskItem
                  task={task}
                  timeZone={props.timeZone}
                  onTask={props.onTask}
                  onProblem={setProblem}
                />
              )}
            </For>
            <li class="task entry-page-add">
              <span class="entry-page-add-mark" aria-hidden="true" />
              <input
                ref={taskField}
                type="text"
                aria-label="New Task for this Entry"
                placeholder="Add a Task to this Entry"
                value={title()}
                onInput={(event) => setTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addTask();
                  }
                }}
              />
              <button
                type="button"
                class="entry-page-add-button"
                disabled={adding() || title().trim() === ""}
                onClick={() => void addTask()}
              >
                <Plus size={16} aria-hidden="true" />
                Add
              </button>
            </li>
          </ul>
          <p class="entry-page-hint">
            A Task added here is added at once. The words stay as they are.
          </p>
        </div>
      </section>
    </Portal>
  );
}
