import type { Export } from "@praxis/domain";
import { createSignal, Show } from "solid-js";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";
import { zip } from "./zip.ts";

/** The name an Export's zip downloads under: the day it was made, as the Deployment counts days (UTC). */
function zipName(made: Export): string {
  return `praxis-export-${made.made_at.slice(0, 10)}.zip`;
}

/** The zip of an Export: each of its files as indented JSON, at its path. */
function zipOf(made: Export): Blob {
  const encoder = new TextEncoder();
  const files = made.files.map(({ path, content }) => ({
    path,
    bytes: encoder.encode(`${JSON.stringify(content, null, 2)}\n`),
  }));
  return new Blob([zip(files, new Date(made.made_at))], { type: "application/zip" });
}

/** Hand the person a file to keep, as the browser saves a download. */
function download(blob: Blob, name: string): void {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  // Some browsers, Safari on iOS among them, read the file after the click is handled, so its
  // address is kept a while rather than let go at once.
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

/**
 * Making an Export, in the Deployment's settings (section 8.6): the whole Deployment, every
 * Context in it, as a zip of Praxis's own JSON files the person keeps. Only their hand makes one.
 */
export function ExportSettings() {
  const [problem, setProblem] = createSignal<string | null>(null);
  const [making, setMaking] = createSignal(false);

  async function make() {
    setMaking(true);
    try {
      const result = await callDeploymentTool("make_export", {});
      if (!result.ok) {
        setProblem(result.error.message);
        return;
      }
      setProblem(null);
      download(zipOf(result.value), zipName(result.value));
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setMaking(false);
    }
  }

  return (
    <section id="export" class="settings" aria-labelledby="export-heading">
      <h2 id="export-heading" class="column-heading">
        Export
      </h2>
      <button type="button" disabled={making()} onClick={() => void make()}>
        {making() ? "Making the Export…" : "Make an Export"}
      </button>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <p class="settings-note">
        The whole Deployment, every Context in it, retired ones too: the Journal with its Versions,
        the Trash and the Run records. Never a Conversation or a key. It is not encrypted, and once
        downloaded it is yours: Praxis cannot reach it.
      </p>
    </section>
  );
}
