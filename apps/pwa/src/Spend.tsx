import type { Spend } from "@praxis/domain";
import { createSignal, Show } from "solid-js";
import { SettingRow, SettingsGroup } from "./design/SettingRows.tsx";
import { followRecord } from "./follow-record.ts";
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

/** The month's spend against its cap, as in "$4.00 of $20.00", or null unread. */
export function spendListed(): string | null {
  const spent = spend();
  return spent && `${money.format(spent.spent)} of ${money.format(spent.cap)}`;
}

/** What the cap's field says of what was typed in it that is not an amount. */
const NOT_AN_AMOUNT = "Type an amount in US dollars, such as 40.";

/** An amount as typed in the cap's field: whole dollars, with up to two places of cents. */
const AN_AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * The spend cap in the Deployment's settings (section 8.6): the month's spend against it, and the
 * cap set here, by the person's hand, its field holding the cap as last read. Raising it takes
 * effect at once.
 */
export function SpendSettings() {
  const { change, sending, problemAt, say, unsay } = sectionChanges();
  // What the last cap set did, said until the person types in its field again.
  const [said, setSaid] = createSignal<string | null>(null);
  let field!: HTMLInputElement;
  const cap = followRecord(
    () => field,
    () => {
      const read = spend();
      return read ? String(read.cap) : "";
    },
  );

  async function save() {
    const typed = field.value.trim();
    // Dollars, and cents if any: not the other forms a number takes, such as 0x10 or 1e3.
    const dollars = AN_AMOUNT.test(typed) ? Number(typed) : Number.NaN;
    if (!(dollars > 0)) {
      say("cap", NOT_AN_AMOUNT);
      return;
    }
    unsay("cap");
    if (dollars === spend()?.cap) return;
    // The field shows the cap again once the spend is read after it.
    const set = await cap.send(async () => {
      const done = await change("cap", () => callDeploymentTool("set_spend_cap", { cap: dollars }));
      if (done !== null) await Promise.all([readSpend(), readNotices()]);
      return done;
    });
    if (set !== null) setSaid(`The cap is now ${money.format(set.record.cap)}.`);
  }

  return (
    <SettingsSection note="At the cap the Agent starts no new Run; the Journal and Connections keep working. Set a spend limit with your model's provider too: it is the hard backstop.">
      <SettingsGroup heading="This month">
        <SettingRow
          title="Spent this month"
          control={() => (
            <span class="settings-row-value" data-testid="spend-against-cap">
              {spendListed() ?? "Reading…"}
            </span>
          )}
        />
      </SettingsGroup>
      <SettingsGroup
        heading="The cap"
        problem={problemAt("cap")}
        below={
          <p class="settings-said" role="status">
            {said() ?? ""}
          </p>
        }
      >
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
                {/* Text, so what is typed stays as typed and is said wrong in words, not refused. */}
                <input
                  ref={field}
                  id={ids.id}
                  aria-describedby={ids.describedBy}
                  aria-invalid={problemAt("cap") === NOT_AN_AMOUNT ? "true" : undefined}
                  class="settings-amount"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  onInput={() => {
                    setSaid(null);
                    cap.typed();
                  }}
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
