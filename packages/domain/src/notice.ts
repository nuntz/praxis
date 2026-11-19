/**
 * Why a Run failed, as the Notice under the person's Message says (section 5.6). Two failures are
 * told apart: the model could not be reached, which shows only on the Run that failed, and the
 * provider refused the key (wrong, out of credit, or at the provider's own limit), which is a
 * standing Notice too until a call succeeds.
 */
export type RunFailure = "model_unavailable" | "key_refused";

/**
 * The Notice under a person's Message whose Run failed (section 8.5). It is not a Message: it
 * says why, and `retry_run` tries that Run again.
 */
export type RunNotice = { run: string; failure: RunFailure };

/**
 * A standing Notice (section 8.3): Praxis telling the person about its own condition until its
 * cause is gone. Attention shows them above the Held Changes, and settings shows them too; they
 * are not counted.
 *
 * - `key_refused`: the model's provider refused the key since this instant, until a call succeeds.
 * - `nearing_cap`: the month's spend has passed 80% of the cap.
 * - `cap_reached`: the month's spend has reached the cap, and no new Run starts.
 */
export type StandingNotice =
  | { kind: "key_refused"; since: string }
  | { kind: "nearing_cap" | "cap_reached"; spent: number; cap: number };
