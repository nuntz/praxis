import { createModels, type Models, type Usage } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { NoAgent, RunFailure } from "@praxis/domain";

/**
 * The model the Agent runs on (section 5.6, ADR 0017): one model from one provider, reached
 * directly from the Worker with the person's own key. One of the four faked things (section 13):
 * the real one is Anthropic's, and tests put a scripted model in its place. Either way it is
 * pi-ai's models holding the provider, and which of its models to ask.
 */
export interface AgentModel {
  readonly models: Models;
  readonly provider: string;
  /** The model's name, as the Deployment's configuration gives it and the Run record keeps it. */
  readonly id: string;
  /** How a Run asks it again when it cannot be reached. */
  readonly retry: RunRetry;
}

/**
 * How a Run asks the model again when it cannot be reached: a few times, each after twice the
 * wait of the last, so for seconds and no more, and then the Run fails (section 5.6). An answer
 * that only waiting mends is asked again; one that says the key is refused is not.
 */
export type RunRetry = { maxRetries: number; baseDelayMs: number; maxAgentDelayMs: number };

/** For the real model: after 1, 2 and 4 seconds, so a Run fails some 7 seconds in. */
export const RUN_RETRY: RunRetry = { maxRetries: 3, baseDelayMs: 1000, maxAgentDelayMs: 4000 };

/** What a model costs, in US dollars per million tokens. */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * The models the code ships a price for, so every Run can be counted against the cap (ADR 0017).
 * Another model is a release.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};

/** The model a Deployment runs on when its configuration names none. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** What the tokens of a Run cost on a model, by the price table shipped with the code. */
export function costOf(model: string, usage: Pick<Usage, keyof Price>): number {
  const price = PRICES[model];
  if (!price) return 0;
  const dollars =
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheRead * price.cacheRead +
    usage.cacheWrite * price.cacheWrite;
  return dollars / 1_000_000;
}

/** What the Deployment's configuration says of the model: a key, which is a secret, and a name. */
export type ModelConfiguration = { AGENT_API_KEY?: string; AGENT_MODEL?: string };

/** The model the configuration names, or the default when it names none. */
function configuredModel(env: ModelConfiguration): string {
  return env.AGENT_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Why the configured model cannot be deployed, or null when it can: one with no price shipped with
 * the code fails the deploy with this reason (ADR 0017). `scripts/check-model.ts` runs it.
 */
export function unpricedModel(env: ModelConfiguration): string | null {
  const id = configuredModel(env);
  if (id in PRICES) return null;
  return `The configured model ${JSON.stringify(id)} has no price shipped with Praxis, so its Runs could not be counted against the spend cap. Name one of: ${Object.keys(PRICES).join(", ")}.`;
}

/**
 * The Agent's model as the Deployment's configuration names it, called with the person's own key,
 * or why there is no Agent: no key, or a model the code ships no price for, which is no Agent
 * rather than one whose Runs go uncounted. The key is read from the configuration and is never
 * kept in an object's storage.
 */
export function anthropicModel(env: ModelConfiguration): AgentModel | NoAgent {
  const key = env.AGENT_API_KEY?.trim();
  if (!key) return "no_key";
  const id = configuredModel(env);
  if (!(id in PRICES)) return "model_has_no_price";
  const models = createModels({
    authContext: {
      env: async (name) => (name === "ANTHROPIC_API_KEY" ? key : undefined),
      fileExists: async () => false,
    },
  });
  models.setProvider(anthropicProvider());
  return { models, provider: "anthropic", id, retry: RUN_RETRY };
}

/**
 * What the provider says when it refuses the key rather than being unavailable: the key is wrong
 * or not allowed (401, 403), the account is out of credit, or it has reached the spend limit set
 * with the provider. Asking again does not mend these, and the person can (section 5.6).
 */
const KEY_REFUSED =
  /(?<![a-z0-9])(?:401|403)(?![a-z0-9])|authentication_error|permission_error|x-api-key|credit balance|billing|usage limits?/i;

/**
 * Why a Run failed, from how the runtime says it ended: the provider refusing the key, told by
 * its own words for it, or the model not being reached, which is everything else, since only
 * waiting mends it (section 5.6).
 */
export function runFailure(reason: string, detail: unknown): RunFailure {
  if (reason === "model_error" && typeof detail === "string" && KEY_REFUSED.test(detail)) {
    return "key_refused";
  }
  return "model_unavailable";
}
