/**
 * A Deployment is one person's, and only the person's Google address signs in to it (section 7.1).
 * The deploy is given that one address and fails before changing anything without it, or while a
 * setting that let in more than the person is left in the configuration.
 */

/** The settings that let in more than the person: a list of addresses, and a Workspace domain. */
export const LETTING_IN_MORE = ["allowedEmails", "allowedEmailDomain"] as const;

const EDIT = "Change it with `pulumi env edit <org>/praxis/production` (docs/deployment.md).";

/**
 * One address: something before one @, a domain after it, and no space or comma anywhere. The
 * wizard asks again until its answer passes the same pattern (scripts/setup-deployment.sh).
 */
export const ONE_ADDRESS = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

/**
 * Why a deploy may not run with the configured sign-in, or null when it may: given the address
 * configured, and the settings that let in more than the person still left in the configuration.
 */
export function signInRefusal(given: {
  signInEmail: string | undefined;
  lettingInMore: readonly string[];
}): string | null {
  const email = given.signInEmail?.trim() ?? "";
  if (given.lettingInMore.length > 0) {
    const named = given.lettingInMore.map((key) => `praxis:${key}`).join(" and ");
    return `${named} let in more than the person, and a Deployment lets in only the person's Google address: take them out, and name the address alone in praxis:signInEmail. ${EDIT}`;
  }
  if (!email) {
    return `Set praxis:signInEmail to your Google address, the only one that signs in: otherwise no one can. ${EDIT}`;
  }
  if (!ONE_ADDRESS.test(email)) {
    return `praxis:signInEmail is ${JSON.stringify(email)}: name one Google address, such as person@example.com, and no domain or list. ${EDIT}`;
  }
  return null;
}
