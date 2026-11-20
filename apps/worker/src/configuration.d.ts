// The Deployment's configuration that `wrangler types` cannot see: secrets, kept outside the repo
// and given to the Worker on deploy (section 12), and the bindings only the deploy adds.
interface Env {
  /** The Agent's provider key, the person's own (ADR 0017). Optional: without it there is no Agent. */
  AGENT_API_KEY?: string;
  /** The private half of the Web Push signing key pair, a JWK as JSON, which the wizard makes. */
  PUSH_PRIVATE_KEY?: string;
  /**
   * Workers AI, which embeds each Entry for the meaning index (section 9.4). The deploy binds it
   * (scripts/deploy-config.ts), never wrangler.jsonc, since a binding to it reaches the account
   * even in tests and on this machine.
   */
  AI?: Ai;
  /** The Vectorize index the embeddings are kept in, bound by the deploy as AI is. */
  MEANING?: Vectorize;
}
