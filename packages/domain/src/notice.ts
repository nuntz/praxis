import type { ClockKind } from "./clock.ts";

/**
 * Why a Run failed, as the Notice under the person's Message says (section 5.6). Three failures
 * are told apart by the provider's answer: a refused key first, by its status, its error's type
 * or its sentences for low credit, since it answers that as a 400; then any other 4xx but a rate
 * limit or a timeout, a refused request; then anything else, the model not reached.
 *
 * - `model_unavailable`: the model could not be reached, which only waiting mends. It shows only
 *   on the Run that failed, and a Brief or Review is tried again.
 * - `key_refused`: the provider refused the key (wrong, out of credit, or at the provider's own
 *   limit), which is a standing Notice too until a call succeeds. No wait mends it.
 * - `request_refused`: the provider answered and refused the request itself, which no wait and
 *   no key mends, only a release or a changed Conversation. It shows only on the Run that failed.
 */
export type RunFailure = "model_unavailable" | "key_refused" | "request_refused";

/**
 * Whether waiting mends a failure, so that a Brief or Review that failed so is tried again
 * (section 5.4): only the model not being reached.
 */
export function mendedByWaiting(failure: RunFailure): boolean {
  return failure === "model_unavailable";
}

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
 * - `voice_key_refused`: the voice provider refused the voice key since this instant, so no Call
 *   starts, until one is set up (section 6).
 * - `nearing_cap`: the month's spend has passed 80% of the cap.
 * - `cap_reached`: the month's spend has reached the cap, and no new Run starts.
 * - `clock_failed`: a Brief or a Review that was due could not run since this instant, and why.
 *   One the model could not be reached for is tried again with a growing gap until it runs or the
 *   next one is due; one whose key or request the provider refused is not (section 5.4). The
 *   Notice stays until one of its kind runs. Its `failure` is told apart as a Run's is (see
 *   `RunFailure`). A refused request is no standing Notice of its own: it is not the
 *   Deployment's, as a refused key is.
 * - `no_backup`: no daily Backup has been made for three days (section 10.3), and when the last
 *   one was, or null when none has been. It stays until one is made. It is not a Notification.
 * - `context_stuck`: a Context's object is stuck on its upgrade under this release (section 11),
 *   by its name, and serves nothing until a release that mends it is deployed. The last Backup
 *   holding it, made at `backup_kept`, or none when null, is kept past its 30 days until it
 *   upgrades. It stays until the Context upgrades.
 */
export type StandingNotice =
  | { kind: "key_refused" | "voice_key_refused"; since: string }
  | { kind: "nearing_cap" | "cap_reached"; spent: number; cap: number }
  | { kind: "clock_failed"; clock: ClockKind; failure: RunFailure; since: string }
  | { kind: "no_backup"; last_made: string | null }
  | { kind: "context_stuck"; context: string; release: string; backup_kept: string | null };
