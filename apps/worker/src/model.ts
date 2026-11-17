import { createModels, type Models, type Usage } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { NoAgent } from "@praxis/domain";

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
}

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

/**
 * The Agent's model as the Deployment's configuration names it, called with the person's own key,
 * or why there is no Agent: no key, or a model the code ships no price for, which is no Agent
 * rather than one whose Runs go uncounted. The key is read from the configuration and is never
 * kept in an object's storage.
 */
export function anthropicModel(env: ModelConfiguration): AgentModel | NoAgent {
  const key = env.AGENT_API_KEY?.trim();
  if (!key) return "no_key";
  const id = env.AGENT_MODEL?.trim() || DEFAULT_MODEL;
  if (!(id in PRICES)) return "model_has_no_price";
  const models = createModels({
    authContext: {
      env: async (name) => (name === "ANTHROPIC_API_KEY" ? key : undefined),
      fileExists: async () => false,
    },
  });
  models.setProvider(anthropicProvider());
  return { models, provider: "anthropic", id };
}
