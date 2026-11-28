import type { LastBackup } from "@praxis/domain";
import { createSignal, onMount, Show } from "solid-js";
import { Problem, SettingRow, SettingsGroup } from "./design/SettingRows.tsx";
import { deviceTimeZone } from "./device.ts";
import { ExportSettings } from "./Export.tsx";
import { standingNotice } from "./Notices.tsx";
import { SettingsSection, sectionChanges } from "./SettingsSection.tsx";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";

const madeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: deviceTimeZone(),
});

/** The day of a Backup, on this Device, as in "Nov 21". */
const backupDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: deviceTimeZone(),
});

/** The day of the last Backup, or that none was made, as the phone's list of sections shows it. */
export async function backupsListed(): Promise<string | null> {
  const result = await callDeploymentTool("get_last_backup", {});
  if (!result.ok) return null;
  const made = result.value.made_at;
  return made === null ? "None" : backupDay.format(new Date(made));
}

/**
 * Backups and Export, in the Deployment's settings (sections 8.6 and 10.3): when the last Backup
 * was made, and making an Export. While no Backup has been made for three days, as the standing
 * Notice in Attention says, it opens by saying since when and that an Export keeps a copy now.
 * Praxis knows only when the last one was made, so it says no more than that.
 */
export function BackupsAndExport() {
  const overdue = () => standingNotice("no_backup");
  return (
    <SettingsSection
      note={
        <Show
          when={overdue()}
          fallback="Praxis backs up the whole Deployment by itself each day. An Export is the same file, made when you ask, for you to keep."
        >
          {(notice) => {
            const made = notice().last_made;
            return made === null
              ? "No Backup yet. An Export keeps a copy now."
              : `No Backup since ${backupDay.format(new Date(made))}. An Export keeps a copy now.`;
          }}
        </Show>
      }
    >
      <BackupSettings />
      <ExportSettings changes={sectionChanges()} />
    </SettingsSection>
  );
}

/**
 * The daily Backup: when the last one was made, read as the section opens. When none has been
 * made for three days a standing Notice says so in Attention. There is nothing to switch.
 */
function BackupSettings() {
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
        title="Last Backup"
        description="Praxis makes one each day by itself, the same file as an Export, and keeps each for 30 days in the Deployment's R2 bucket, on your own Cloudflare account. There is no switch."
        control={() => (
          // A read that fails is said in place of what it could not read.
          <Show when={!problem()} fallback={<Problem message={problem()} />}>
            <span class="settings-row-value" data-testid="last-backup">
              <Show when={last()} fallback="Reading…">
                {(read) => {
                  const made = read().made_at;
                  return made === null ? "None yet" : madeFormat.format(new Date(made));
                }}
              </Show>
            </span>
          </Show>
        )}
      />
    </SettingsGroup>
  );
}
