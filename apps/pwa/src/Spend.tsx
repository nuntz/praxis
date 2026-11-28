import type { Spend } from "@praxis/domain";
import { createSignal, Show } from "solid-js";
import { SettingRow, SettingsGroup } from "./design/SettingRows.tsx";
import { latestRead } from "./latest-read.ts";
import { capWords, money, readNotices } from "./Notices.tsx";
import { CAP_FIELD } from "./SettingsLink.tsx";
import { SettingsSection, sectionChanges } from "./SettingsSection.tsx";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";

/**
 * The Deployment's spend this month against its cap (section 5.7), as last read. It is the whole
 * Deployment's, whatever Context is current, so one copy serves the settings, Attention and the
 * Conversation. It is read when the screen opens or comes back into view, after a Run ends and
 * after the cap is set, so a month that turned or a cap raised elsewhere shows.
 */
const [spend, setSpend] = createSignal<Spend | null>(null);

export { spend };

/** Read the month's spend afresh. A read that fails leaves what was shown. */
export const { read: readSpend } = latestRead(async (current) => {
  try {
    const result = await callDeploymentTool("get_spend", {});
    if (current() && result.ok) setSpend(result.value);
  } catch (error) {
    unreachableMessage(error);
  }
});

/** Read the spend now, and again each time the screen comes back into view. Returns the stop. */
export function followSpend(): () => void {
  void readSpend();
  const again = () => {
    if (document.visibilityState === "visible") void readSpend();
  };
  document.addEventListener("visibilitychange", again);
  return () => document.removeEventListener("visibilitychange", again);
}

/**
 * The cap's Notice in the Conversation, in place of its composer at the cap, as the spend last
 * read says. Attention shows it among the standing Notices, from `list_notices`.
 */
export function CapNotice() {
  return (
    <Show when={spend()?.notice ? spend() : null}>
      {(shown) => (
        <p class="notice" role="status" data-testid="spend-notice">
          {capWords({ ...shown(), notice: shown().notice ?? "nearing_cap" })}
        </p>
      )}
    </Show>
  );
}

/**
 * The spend cap in the Deployment's settings (section 8.6): the month's spend against it, and the
 * cap set here, by the person's hand. Raising it takes effect at once.
 */
export function SpendSettings() {
  const [cap, setCap] = createSignal("");
  const { change, sending, problemAt, say } = sectionChanges();

  async function save() {
    const dollars = Number(cap());
    if (cap().trim() === "" || !Number.isFinite(dollars)) {
      say("cap", "A spend cap is an amount of US dollars.");
      return;
    }
    const set = await change("cap", () => callDeploymentTool("set_spend_cap", { cap: dollars }));
    if (set === null) return;
    setCap("");
    await Promise.all([readSpend(), readNotices()]);
  }

  return (
    <SettingsSection note="At the cap the Agent starts no new Run; the Journal and Connections keep working. Set a spend limit with your model's provider too: it is the hard backstop.">
      <SettingsGroup heading="This month">
        <SettingRow
          title={
            <Show when={spend()} fallback="Reading this month's spend…">
              {(shown) => (
                <span data-testid="spend-against-cap">
                  {money.format(shown().spent)} spent this month of a {money.format(shown().cap)}{" "}
                  cap.
                </span>
              )}
            </Show>
          }
        />
      </SettingsGroup>
      <SettingsGroup heading="The cap" problem={problemAt("cap")}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SettingRow
            title="Monthly cap, US dollars"
            description="Raising it takes effect at once"
            labels
            id={CAP_FIELD}
            control={(ids) => (
              <>
                <input
                  id={ids.id}
                  aria-describedby={ids.describedBy}
                  class="settings-amount"
                  type="number"
                  inputmode="decimal"
                  min="0.01"
                  step="0.01"
                  value={cap()}
                  placeholder={spend() ? String(spend()?.cap) : ""}
                  onInput={(event) => setCap(event.currentTarget.value)}
                />
                <button type="submit" disabled={sending()}>
                  Set cap
                </button>
              </>
            )}
          />
        </form>
      </SettingsGroup>
    </SettingsSection>
  );
}
