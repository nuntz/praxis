import contextStep1 from "./context-0001.ts";
import contextStep2 from "./context-0002.ts";
import contextStep3 from "./context-0003.ts";
import contextStep4 from "./context-0004.ts";
import deploymentStep1 from "./deployment-0001.ts";
import deploymentStep2 from "./deployment-0002.ts";
import deploymentStep3 from "./deployment-0003.ts";

/**
 * One step of an upgrade ladder (section 11, ADR 0019): it changes the shape of an object's
 * tables, never their meaning, in its own transaction. Each lives in a file of its own, numbered,
 * which imports nothing and is never edited once released: `lint/steps.test.ts` holds each to the
 * hash `released.json` keeps of it. A step may meet tables that already hold its change, as an
 * object made before the ladder climbs every step, so it looks before it alters, as step 1's
 * `addMissingColumns` does. `test/upgrade.test.ts` runs a new step so; run it before keeping the
 * step's hash and making the release's fixture, which a mended step has to make again.
 */
export type Step = (sql: SqlStorage) => void;

/** A Context's object's ladder, step 1 first. A new step goes at the end, in a file of its own. */
export const CONTEXT_LADDER: readonly Step[] = [
  contextStep1,
  contextStep2,
  contextStep3,
  contextStep4,
];

/** The Deployment object's ladder, step 1 first. A new step goes at the end, in a file of its own. */
export const DEPLOYMENT_LADDER: readonly Step[] = [
  deploymentStep1,
  deploymentStep2,
  deploymentStep3,
];
