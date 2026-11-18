import type { Spend } from "@praxis/domain";
import { createSignal, Show } from "solid-js";
import { callDeploymentTool, unreachableMessage, writeToDeployment } from "./tools.ts";

/**
 * The Deployment's spend this month against its cap (section 5.7), as last read. It is the whole
 * Deployment's, whatever Context is current, so one copy serves the settings, Attention and the
 * Conversation. It is read when the screen opens or comes back into view, after a Run ends and
 * after the cap is set, so a month that turned or a cap raised elsewhere shows.
 */
const [spend, setSpend] = createSignal<Spend | null>(null);

export { spend };

// Each read is numbered: an answer a later read overtook is dropped, so the last read wins.
let reads = 0;

/** Read the month's spend afresh. A read that fails leaves what was shown. */
export async function readSpend(): Promise<void> {
  const mine = ++reads;
  try {
    const result = await callDeploymentTool("get_spend", {});
    if (mine === reads && result.ok) setSpend(result.value);
  } catch (error) {
    unreachableMessage(error);
  }
}

/** Read the spend now, and again each time the screen comes back into view. Returns the stop. */
export function followSpend(): () => void {
  void readSpend();
  const again = () => {
    if (document.visibilityState === "visible") void readSpend();
  };
  document.addEventListener("visibilitychange", again);
  return () => document.removeEventListener("visibilitychange", again);
}

/** Bring the cap's field into view in the settings, and put the person there. */
export function focusCapField(): void {
  const field = document.getElementById("spend-cap");
  field?.scrollIntoView({ block: "center" });
  field?.focus();
}

export const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

/**
 * The standing Notice the month's spend gives, if any: past 80% of the cap, or the cap reached.
 * It stays until its cause is gone. `list_notices` (#65) will carry it, with the other standing
 * Notices; until then the screen reads it from `get_spend`.
 */
export function CapNotice() {
  return (
    <Show when={spend()?.notice ? spend() : null}>
      {(shown) => (
        <p class="notice" role="status" data-testid="spend-notice">
          {shown().notice === "cap_reached"
            ? `This month's spend has reached its cap of ${money.format(shown().cap)}: the Agent starts no new Run until the cap is raised or the month turns.`
            : `This month's spend, ${money.format(shown().spent)}, has passed 80% of its cap of ${money.format(shown().cap)}.`}
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
  const [problem, setProblem] = createSignal<string | null>(null);
  const [cap, setCap] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  async function save() {
    const dollars = Number(cap());
    if (cap().trim() === "" || !Number.isFinite(dollars)) {
      setProblem("A spend cap is an amount of US dollars.");
      return;
    }
    setSaving(true);
    try {
      const set = await writeToDeployment("set_spend_cap", { cap: dollars }, setProblem);
      if (set) {
        setCap("");
        await readSpend();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="spend" class="settings" aria-labelledby="spend-heading">
      <h2 id="spend-heading" class="column-heading">
        Spend
      </h2>
      <Show when={spend()} fallback={<p class="settings-note">Reading this month's spend…</p>}>
        {(shown) => (
          <p data-testid="spend-against-cap">
            {money.format(shown().spent)} spent this month of a {money.format(shown().cap)} cap.
          </p>
        )}
      </Show>
      <CapNotice />
      <form
        class="context-rename"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label for="spend-cap">Monthly cap, US dollars</label>
        <input
          id="spend-cap"
          type="number"
          inputmode="decimal"
          min="0.01"
          step="0.01"
          value={cap()}
          placeholder={spend() ? String(spend()?.cap) : ""}
          onInput={(event) => setCap(event.currentTarget.value)}
        />
        <button type="submit" disabled={saving()}>
          Set cap
        </button>
      </form>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <p class="settings-note">
        At the cap the Agent starts no new Run; the Journal and Connections keep working. Set a
        spend limit with your model's provider too: it is the hard backstop.
      </p>
    </section>
  );
}
