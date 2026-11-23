import AxeBuilder from "@axe-core/playwright";
import {
  type APIResponse,
  test as base,
  expect,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import type { Accent, ContextListing } from "@praxis/domain";

/** WCAG 2.2 AA, and the levels under it (section 8.11). */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Every journey ends with an automated accessibility check of the screen as it was left, in light
 * and in dark (section 13). A journey that failed or was skipped is not checked on top, and none is
 * under load (`test:e2e:stress`): there the one Deployment collects every journey's Contexts, which
 * each settings screen lists, so the check of one ran past the test's time on a 4-core runner,
 * and what it would find, the push's own run finds.
 */
export const test = base.extend<{ accessible: undefined }>({
  accessible: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== "passed" || process.env.PRAXIS_E2E_STRESS) return;
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        const found = violations.map(({ id, help, nodes }) => ({
          id,
          help,
          targets: nodes.map((node) => node.target.join(" ")),
        }));
        expect(found, `accessibility in ${colorScheme}`).toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Whether a journey runs on a phone, which shows one column at a time behind three tabs. */
export function onPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name === "phone";
}

/**
 * A column brought into view by its tab on a phone, which shows one column at a time; wider, every
 * column is in view already. A tab's name begins with its column's, and may go on with its count.
 */
export async function showTab(
  page: Page,
  testInfo: TestInfo,
  tab: "Attention" | "Journal" | "Agent",
) {
  if (!onPhone(testInfo)) return;
  await page
    .getByRole("navigation", { name: "Columns" })
    .getByRole("button", { name: new RegExp(`^${tab}`) })
    .click();
}

/** The Journal column, brought into view first on a phone, where the screen opens on Attention. */
export async function openJournal(page: Page, testInfo: TestInfo) {
  await showTab(page, testInfo, "Journal");
  const journal = page.getByRole("region", { name: "Journal" });
  return { journal, composer: journal.getByRole("textbox", { name: /^Record an Entry in / }) };
}

/** A preset of the search's time chip picked from its picker, the chip not set before. */
export async function pickTime(page: Page, name: "Today" | "Last 7 days" | "Last 30 days") {
  const journal = page.getByRole("region", { name: "Journal" });
  await journal
    .getByRole("group", { name: "Narrow the search" })
    .getByRole("button", { name: "Any time" })
    .click();
  await journal.getByRole("dialog", { name: "Time" }).getByRole("button", { name }).click();
}

/** An Entry's actions its toolbar shows, where the Device has a pointer that hovers. */
const FREQUENT = ["Edit", "Follow up", "Mark Standing", "Unmark Standing"];

/**
 * One of an Entry's actions, reached as the person reaches it (section 8.4): on the desktop, in
 * the toolbar the Entry shows under the pointer, Move, Delete and Discard behind its More; on the
 * phone, in the menu behind its one button. The toolbar or the menu is left showing it.
 */
export async function entryAction(
  entry: Locator,
  name: "Edit" | "Follow up" | "Mark Standing" | "Unmark Standing" | "Move" | "Delete" | "Discard",
  testInfo: TestInfo,
): Promise<Locator> {
  if (onPhone(testInfo)) {
    await entry.getByRole("button", { name: "Actions for this Entry", exact: true }).click();
    return entry.getByRole("menu").getByRole("menuitem", { name, exact: true });
  }
  await entry.hover();
  const toolbar = entry.getByRole("toolbar", { name: "Entry actions", exact: true });
  if (FREQUENT.includes(name)) return toolbar.getByRole("button", { name, exact: true });
  await toolbar.getByRole("button", { name: /^More: / }).click();
  return toolbar.getByRole("menu").getByRole("menuitem", { name, exact: true });
}

/**
 * Open Settings from the top bar's gear at one of its sections, as the person does: from the
 * sections beside the one shown on a desktop, from the list of them on a phone (section 8.6).
 */
export async function openSettings(page: Page, section: string) {
  await page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  return showSection(page, section);
}

/** Show another section of Settings open, from the list of sections, back to it first on a phone. */
export async function showSection(page: Page, section: string) {
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const toList = page.getByRole("banner").getByRole("link", { name: "Settings", exact: true });
  await expect(sections.or(toList)).toBeVisible();
  if (await toList.isVisible()) await toList.click();
  await sections.getByRole("link", { name: section, exact: true }).click();
  const shown = page.getByRole("region", { name: section, exact: true });
  await expect(shown).toBeVisible();
  return shown;
}

/** Put Settings away with Escape, back to the main screen as it was left. */
export async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
}

/** Switch Context in the top bar, as the person does, and wait until it is current. */
export async function switchTo(page: Page, name: string) {
  const switcher = page.getByRole("banner").getByRole("button", { name: /^Context: / });
  await switcher.click();
  await page.getByRole("list", { name: "Contexts" }).getByRole("button", { name }).click();
  await expect(switcher).toHaveAccessibleName(`Context: ${name}`);
}

/** Call a tool as the screen does, at the Deployment's address or at a Context's. */
async function post(page: Page, path: string, input: unknown) {
  const result = await (await page.request.post(path, { data: input })).json();
  expect(result, `${path} answered`).toMatchObject({ ok: true });
  return result.value;
}

/**
 * The Context every journey shares unless it makes its own: the first made, by the setup
 * (first-context.setup.ts), in Blue.
 */
export async function sharedContext(page: Page): Promise<ContextListing> {
  const { items } = await post(page, "/api/deployment/tools/list_contexts", {});
  const first = (items as ContextListing[]).find((context) => !context.retired);
  if (!first) throw new Error("The setup makes the first Context before any journey");
  return first;
}

/** Make a Context of this journey's own, so what it changes is no other journey's. */
export async function makeContext(
  page: Page,
  made: { name: string; time_zone: string; accent: Accent },
): Promise<ContextListing> {
  return (await post(page, "/api/deployment/tools/create_context", made)).record;
}

/**
 * Make a Context of this journey's own, named for what it holds and the project it runs in, in UTC
 * unless another zone is given, and open the screen on it, as `lastShown()` does.
 */
export async function contextOfOwn(
  page: Page,
  testInfo: TestInfo,
  named: string,
  time_zone = "UTC",
): Promise<ContextListing> {
  const made = await makeContext(page, {
    name: `${named} ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone,
    accent: "teal",
  });
  await lastShown(page, made.id);
  return made;
}

/** Call a Deployment tool as the screen does. */
export function callDeploymentTool(page: Page, tool: string, input: unknown) {
  return post(page, `/api/deployment/tools/${tool}`, input);
}

/** Call one of a Context's tools as the screen does. */
export function callContextTool(page: Page, id: string, tool: string, input: unknown) {
  return post(page, `/api/contexts/${id}/tools/${tool}`, input);
}

/**
 * Open the screen on this Context, as a browser that last showed it does. The browser keeps the
 * Context it last showed, so this stands for having switched to it before.
 */
export async function lastShown(page: Page, id: string) {
  // Once per tab: a reload finds whatever the person switched to since, as it would.
  await page.addInitScript((shown) => {
    if (sessionStorage.getItem("praxis.e2e.shown")) return;
    localStorage.setItem("praxis.context", shown);
    sessionStorage.setItem("praxis.e2e.shown", "yes");
  }, id);
}

/**
 * Wait until the service worker has kept the screen, so Praxis opens with no network (section 8.8):
 * it is active only once it has.
 */
export async function screenKept(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

/**
 * Hold every answer the screen gets from a tool, so a journey can act while its read is still out,
 * as load makes it: a step that races the answer then loses on every run (docs/flaky-journeys.md).
 * Each held call is asked of the real server at once, and only its answer is held: fetched one
 * after another once released, the answers to a name typed ran past the test's time under load.
 * Released, they reach the screen in the order the calls were sent.
 */
export async function holdAnswers(page: Page, tool: string) {
  const address = new RegExp(`/tools/${tool}$`);
  const held: { route: Route; answer: Promise<APIResponse> }[] = [];
  await page.route(address, (route) => {
    const answer = route.fetch();
    // A journey that fails first leaves an answer unread, and its page closed under it.
    answer.catch(() => {});
    held.push({ route, answer });
  });
  const release = async () => {
    for (const { route, answer } of held.splice(0)) await route.fulfill({ response: await answer });
    // The screen shows what the answers bring before the journey looks.
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  return {
    /**
     * Wait until a call with this input is held, such as the read of the whole name typed: one
     * per character, and the screen may send more than the characters, so they are not counted.
     */
    async sent(input: Record<string, unknown>) {
      const matches = ({ route }: { route: Route }) => {
        const sent = route.request().postDataJSON() as Record<string, unknown>;
        return Object.entries(input).every(([key, value]) => sent[key] === value);
      };
      await expect.poll(() => held.some(matches)).toBe(true);
    },
    /** Let every answer held so far through. Later calls are held still. */
    release,
    /**
     * Let every answer through and hold no more. Released before unrouting: unrouting hands on a
     * held call, and fulfilling it after throws that it is handled already.
     */
    async stop() {
      await release();
      await page.unroute(address);
    },
  };
}

/**
 * Hold the answer to the next call at one address, such as one Context's `list_tasks`, so a
 * journey changes the state a guard on the screen names while the call it races is out, as
 * `e2e/offline-copy.spec.ts` switches the Offline Copy off while its fetch waits (CODING_STANDARDS.md,
 * Reads and changes). Only that call is held: a later one at the address, such as the read again
 * a change makes the screen send while the first is out (`e2e/changes.spec.ts`), is answered as
 * ever, as is every call elsewhere. `holdAnswers()` holds a tool's answers in every Context.
 */
export async function holdNext(page: Page, address: RegExp) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked!: () => void;
  const wasAsked = new Promise<void>((resolve) => {
    asked = resolve;
  });
  let answered!: () => void;
  const wasAnswered = new Promise<void>((resolve) => {
    answered = resolve;
  });
  await page.route(
    address,
    async (route) => {
      asked();
      const answer = await route.fetch();
      await released;
      await route.fulfill({ response: answer });
      answered();
    },
    { times: 1 },
  );
  return {
    asked: () => wasAsked,
    /** Let the held answer through, and wait until the screen has it. */
    async release() {
      release();
      await wasAnswered;
      await page.evaluate(() => new Promise(requestAnimationFrame));
    },
  };
}

/**
 * Stand in for the browser's launch queue, as the installed PWA has it: a launch the manifest's
 * launch handler sends to a window already open is given to the screen there, with the address it
 * was launched at, and the launch that opened the window is given too, as Chromium gives it.
 * Returns a way to launch Praxis at an address into the window open.
 */
export async function installedApp(page: Page) {
  await page.addInitScript(() => {
    type Consumer = (params: { targetURL: string }) => void;
    const opened = location.href;
    let consumer: Consumer | null = null;
    const waiting: string[] = [opened];
    const give = () => {
      while (consumer) {
        const next = waiting.shift();
        if (next === undefined) return;
        consumer({ targetURL: next });
      }
    };
    // Chromium has its own queue on every page, which gives nothing outside an installed PWA. It is
    // a getter with no setter, so assigning over it throws, and the script stops there unseen.
    Object.defineProperty(window, "launchQueue", {
      value: {
        setConsumer(given: Consumer) {
          consumer = given;
          give();
        },
      },
    });
    Object.assign(window, {
      praxisLaunch(address: string) {
        waiting.push(new URL(address, location.origin).href);
        give();
      },
    });
  });
  return (address: string) =>
    page.evaluate(
      (at) => (window as unknown as { praxisLaunch(a: string): void }).praxisLaunch(at),
      address,
    );
}
