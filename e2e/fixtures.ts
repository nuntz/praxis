import AxeBuilder from "@axe-core/playwright";
import {
  type APIResponse,
  test as base,
  expect,
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
 * each settings screen lists, so the check of one ran past the test's time on a 4-core runner (#88),
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

/** The Journal column, brought into view first on a phone, where the screen opens on Attention. */
export async function openJournal(page: Page, testInfo: TestInfo) {
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Journal" })
      .click();
  }
  const journal = page.getByRole("region", { name: "Journal" });
  return { journal, composer: journal.getByRole("textbox", { name: /^Record an Entry in / }) };
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
