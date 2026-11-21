import { exportZip, exportZipName } from "@praxis/domain";
import { createSignal, Show } from "solid-js";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";

/** Hand the person a file to keep, as the browser saves a download. */
export function download(blob: Blob, name: string): void {
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
  return (
    <section id="export" class="settings" aria-labelledby="export-heading">
      <h2 id="export-heading" class="column-heading">
        Export
      </h2>
      <MakeExport />
      <p class="settings-note">
        The whole Deployment, every Context in it, retired ones too: the Journal with its Versions,
        the Trash and the Run records. Never a Conversation or a key. It is not encrypted, and once
        downloaded it is yours: Praxis cannot reach it.
      </p>
    </section>
  );
}

/**
 * The button that makes an Export and hands it to the person as a download, with what stood in
 * the way if it could not. Offered in the settings, and before a Context is deleted.
 */
export function MakeExport() {
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
      download(
        new Blob([exportZip(result.value)], { type: "application/zip" }),
        exportZipName(result.value),
      );
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setMaking(false);
    }
  }

  return (
    <>
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
    </>
  );
}
