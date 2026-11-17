import { type Entry, inlineTasksAdded } from "@praxis/domain";
import { createSignal, onMount } from "solid-js";
import { unreachableMessage, useCallTool } from "./tools.ts";

/**
 * The Entry editor: the words as typed, with no toolbar and no preview (section 8.4). The change
 * is made against the version the editor opened on, so one made meanwhile is never overwritten:
 * it is `stale`, and the draft stays for the person to keep or drop. A marked line it adds makes
 * a Task, as the composer's do; one it deletes deletes none.
 */
export function EntryEditor(props: {
  entry: Entry;
  onSaved: (entry: Entry) => void;
  onCancel: () => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  // As the editor opened on it: what the change is made against, whatever comes in meanwhile.
  const opened = { words: props.entry.words, version: props.entry.version };
  const [words, setWords] = createSignal(opened.words);
  const [sending, setSending] = createSignal(false);
  const canSave = () => !sending() && words().trim() !== "";
  let field!: HTMLTextAreaElement;

  onMount(() => {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });

  async function save() {
    if (!canSave()) return;
    setSending(true);
    try {
      const result = await callTool("edit_entry", {
        id: props.entry.id,
        words: words(),
        version: opened.version,
        tasks: inlineTasksAdded(opened.words, words()),
      });
      if (!result.ok) {
        return props.onProblem(
          result.error.code === "stale"
            ? "This Entry changed while you were editing it, so your edit was not saved. Your words are still in the editor: cancel to see the Entry as it is now."
            : result.error.message,
        );
      }
      props.onSaved(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      class="entry-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label class="visually-hidden" for={`edit-${props.entry.id}`}>
        The Entry's words
      </label>
      <textarea
        ref={field}
        id={`edit-${props.entry.id}`}
        rows={Math.min(12, Math.max(3, words().split("\n").length + 1))}
        value={words()}
        onInput={(event) => setWords(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div class="entry-editor-actions">
        <button type="submit" disabled={!canSave()}>
          Save
        </button>
        <button type="button" class="quiet" onClick={() => props.onCancel()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
