/**
 * A fault the test harness finds in itself or in the object: a fake asked what it was never set up
 * for (CODING_STANDARDS.md), or a guard of the harness tripped. Thrown while a test awaits it, it
 * fails that test. Thrown off the test's path, as in an alarm the platform fires after the test
 * moved on, workerd only logs it, among the uncaught errors tests make on purpose, and the run
 * passes; so each is kept here as well, and after each test the harness fails it on any kept.
 */

const faults: string[] = [];

/** Keep this fault, and give the error to throw for it. */
export function harnessFault(message: string): Error {
  faults.push(message);
  return new Error(message);
}

/**
 * The faults kept since this was last asked, which it then forgets. One kept between two tests,
 * after the first was checked, is found after the next.
 */
export function takeHarnessFaults(): string[] {
  return faults.splice(0);
}
