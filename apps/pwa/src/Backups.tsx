import type { LastBackup } from "@praxis/domain";
import { createSignal, onMount, Show } from "solid-js";
import { SettingRow, SettingsGroup } from "./design/SettingRows.tsx";
import { deviceTimeZone } from "./device.ts";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";

const madeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: deviceTimeZone(),
});

/** What settings say of the last Backup. */
function lastBackupWords({ made_at }: LastBackup): string {
  return made_at === null
    ? "No Backup has been made yet."
    : `The last Backup was made ${madeFormat.format(new Date(made_at))}.`;
}

/**
 * The daily Backup in the Deployment's settings (sections 8.6 and 10.3): when the last one was
 * made, read as the settings open. When none has been made for three days a standing Notice says
 * so here and in Attention. There is nothing to switch.
 */
export function BackupSettings() {
  const [last, setLast] = createSignal<LastBackup | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const result = await callDeploymentTool("get_last_backup", {});
      if (result.ok) setLast(result.value);
      else setProblem(result.error.message);
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  });

  return (
    <SettingsGroup heading="Backups" region="last-backup">
      <SettingRow
        title={
          // A read that fails is said in place of what it could not read.
          <Show
            when={!problem()}
            fallback={
              <span class="problem" role="alert">
                {problem()}
              </span>
            }
          >
            <Show when={last()} fallback="Reading the last Backup…">
              {(read) => <span data-testid="last-backup">{lastBackupWords(read())}</span>}
            </Show>
          </Show>
        }
        description="Praxis makes one each day by itself, the same file as an Export, and keeps each for 30 days in the Deployment's R2 bucket, on your own Cloudflare account. There is no switch."
      />
    </SettingsGroup>
  );
}
