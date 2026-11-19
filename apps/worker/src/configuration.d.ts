// The Deployment's configuration that `wrangler types` cannot see: secrets, kept outside the repo
// and given to the Worker on deploy (section 12).
interface Env {
  /** The Agent's provider key, the person's own (ADR 0017). Optional: without it there is no Agent. */
  AGENT_API_KEY?: string;
  /** The private half of the Web Push signing key pair, a JWK as JSON, which the wizard makes. */
  PUSH_PRIVATE_KEY?: string;
}
