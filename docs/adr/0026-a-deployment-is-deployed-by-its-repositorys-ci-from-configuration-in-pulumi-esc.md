# A Deployment is deployed by its repository's CI, from configuration in Pulumi ESC

A Deployment's values (the Cloudflare account, hostname and Zero Trust team, who may sign in, the Google client, the Agent's key and model, the jurisdiction) live in a Pulumi ESC environment, with the stack's state in Pulumi Cloud. None is committed: the repo ships only `infra/Pulumi.example.yaml`, which names them. The repository's CI deploys on every push to master. It signs in to Pulumi Cloud through GitHub OIDC, with no Pulumi token stored, runs `pulumi up` for everything around the Worker, then `wrangler deploy` for the Worker and its Durable Object classes, given the vars and secrets Pulumi exports. The setup wizard, `bun run wizard`, writes the ESC environment and sets up CI's sign-in, secrets and variables. Someone else's Deployment is the same arrangement on their own fork. We decided this because it is how mise, which section 12 follows, already deploys, so its wizard, its OIDC trust and its deploy job are proven, and because a deploy from a pushed commit is one a test run has passed.

## Considered Options

- **The person deploys from their own machine** with a `bun run deploy` command, and the repository's CI never deploys. Rejected: each machine needs Pulumi, Wrangler and the Cloudflare token, and a deploy can ship a commit no test run has seen.
- **A local Pulumi backend**, with the state and passphrase-encrypted settings outside the repo. Rejected: CI could not reach it, and losing the passphrase loses the secrets.
- **A long-lived Pulumi token as a CI secret.** Rejected: a leaked token works anywhere until someone revokes it.
- **Pulumi making the Worker script itself.** Rejected: Wrangler builds the Worker, uploads the screen's files and applies the Durable Object migrations, which a Pulumi resource would have to do again.

## Consequences

- A deploy is a push to master, or a re-run of the last push's CI run. A run started by hand only tests, because Pulumi Cloud trusts only this repository's deploy job on a push to master.
- Until `bun run wizard` has set `PULUMI_STACK`, and on a fork without one, the deploy job is skipped.
- The logs are public, so the job masks every configuration value and Pulumi output before it runs anything.
- Changing a key, the model or anything else is a change to the ESC environment and a deploy (section 12).
- A model with no price shipped with Praxis fails the deploy before anything changes (ADR 0017).
- Every var of the Worker, the model among them, is set afresh by each deploy. Secrets are only added by Wrangler, so the deploy deletes the Agent's key itself when the configuration no longer has one, and the Worker then has no Agent (ADR 0017).
- Section 11's check for a Backup from the last day, with the person's override, is a step of this deploy job, before `pulumi up`.
- A `wrangler deploy` run by hand would deploy without the Worker's vars, so it is never done against a Deployment.
- The jurisdiction is a plain var of the Worker, so the next `pulumi up` reads it back from the deployed Worker and fails, before changing anything, when the configuration names another.
