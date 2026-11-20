import contextStep1 from "./context-0001.ts";
import deploymentStep1 from "./deployment-0001.ts";

/**
 * One step of an upgrade ladder (section 11, ADR 0019): it changes the shape of an object's
 * tables, never their meaning, in its own transaction. Each lives in a file of its own, numbered,
 * which imports nothing and is never edited once released: `lint/steps.test.ts` holds each to the
 * hash `released.json` keeps of it.
 */
export type Step = (sql: SqlStorage) => void;

/** A Context's object's ladder, step 1 first. A new step goes at the end, in a file of its own. */
export const CONTEXT_LADDER: readonly Step[] = [contextStep1];

/** The Deployment object's ladder, step 1 first. A new step goes at the end, in a file of its own. */
export const DEPLOYMENT_LADDER: readonly Step[] = [deploymentStep1];
