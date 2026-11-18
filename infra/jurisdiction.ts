/**
 * The jurisdiction a Deployment keeps every object in is chosen once at setup, and changes only
 * by an Export restored into a new Deployment (section 9.2): a Worker that named its objects in
 * another would find none of them. The deploy reads the one the deployed Worker runs with and
 * fails before changing anything when the configuration names another.
 */

/** The jurisdictions offered, as Durable Objects name them; none is the empty string. */
export const JURISDICTIONS = ["eu", "us", "fedramp"] as const;

const described = (jurisdiction: string) => (jurisdiction ? JSON.stringify(jurisdiction) : "none");

/**
 * The jurisdiction a deployed Worker runs with, from the settings the Cloudflare API answers for
 * it: its JURISDICTION var, or none without one. Throws on an answer with no bindings, since a
 * guess could let a deploy move the objects out of reach.
 */
export function deployedJurisdiction(settings: unknown): string {
  const bindings = (settings as { result?: { bindings?: unknown } } | null)?.result?.bindings;
  if (!Array.isArray(bindings)) {
    throw new Error(
      "The deployed Worker's settings hold no bindings to read its jurisdiction from.",
    );
  }
  const found = bindings.find(
    (binding) => binding?.name === "JURISDICTION" && binding?.type === "plain_text",
  );
  return typeof found?.text === "string" ? found.text : "";
}

/**
 * Why a deploy may not run with the configured jurisdiction, or null when it may: on a first
 * deploy (nothing deployed) any one offered, and afterwards only the one deployed.
 */
export function jurisdictionRefusal(given: {
  deployed: string | null;
  configured: string;
}): string | null {
  const { deployed, configured } = given;
  if (configured && !(JURISDICTIONS as readonly string[]).includes(configured)) {
    return `praxis:jurisdiction is ${JSON.stringify(configured)}: name one of ${JURISDICTIONS.join(", ")}, or leave it out for none.`;
  }
  if (deployed === null || deployed === configured) return null;
  return `This Deployment keeps its objects in the jurisdiction ${described(deployed)}, and praxis:jurisdiction names ${described(configured)}. The jurisdiction is chosen once: set it back to ${described(deployed)}. To move, Export from this Deployment and restore the file into a new one.`;
}
