# Deploying Praxis

A Deployment is one person's Praxis on their own Cloudflare account (SPEC section 12, ADR 0026). Its values live in a Pulumi ESC environment, never in this repo, and the repository's CI deploys it on every push to master.

## What you need

- A Cloudflare account with a zone (a domain) for Praxis's hostname, and Zero Trust onboarded (the Free plan is enough).
- A Pulumi Cloud account, and `pulumi`, `gh` and `bun` installed, with `gh` signed in to your fork of this repo.
- A Google account to sign in with, and a Google Cloud project for the OAuth client Access signs you in through.
- Optional: an Anthropic API key for the Agent. Without one there is no Agent, and the rest of Praxis works as normal.

## Setting up

```sh
bun run wizard
```

It walks you through each step in the browser and keeps what you enter in `~/.config/praxis/deploy.env` (mode 0600; `PRAXIS_DEPLOY_ENV` names another file). Stop with Ctrl-C at any point. A re-run offers what you entered before.

1. Signs you in to Pulumi Cloud.
2. Takes the Cloudflare account, zone, hostname and Zero Trust team domain.
3. Has you make a Cloudflare API token for Pulumi and Wrangler, with these permissions on your account and zone: Account · Workers Scripts · Edit; Account · Access: Apps and Policies · Edit; Account · Access: Organizations, Identity Providers, and Groups · Edit; Zone · Workers Routes · Edit; Zone · DNS · Edit.
4. Has you make a Google OAuth client for Access's Google sign-in.
5. Takes who may sign in: your Google address, or a Workspace domain.
6. Takes the Agent's key and model, both optional, checks the model is one Praxis ships a price for, and says to set a spend limit with Anthropic.
7. Offers the jurisdiction, once (below).
8. Writes the ESC environment `<org>/praxis/production` and the stack `<org>/praxis/production`, whose gitignored stack file only imports the environment.
9. Sets up CI's sign-in to Pulumi Cloud (below), and the `CLOUDFLARE_API_TOKEN` and `PULUMI_CI_USER` secrets and the `PULUMI_STACK` and `PULUMI_ESC_ENVIRONMENT` variables.
10. Starts a deploy and watches it, then opens Praxis. You sign in through Access, make your first Context (its name, time zone and accent colour) and record an Entry. The monthly spend cap starts at 20 US dollars: Settings → Spend changes it.

`infra/Pulumi.example.yaml` names every setting, for editing the ESC environment by hand.

## What a deploy does

The `deploy` job in `.github/workflows/ci.yml` runs after the checks pass, on a push to master, once `PULUMI_STACK` is set:

1. Signs in to Pulumi Cloud through OIDC and masks every configuration value, since the logs are public.
2. Checks the model is one Praxis ships a price for, so a deploy with any other fails before anything changes.
3. `pulumi up` (`infra/index.ts`): Google as an identity provider, an Access policy for you, and one Access application for the hostname, with managed OAuth on. That lets in MCP clients that register themselves and come back to Claude (`https://claude.ai/api/mcp/auth_callback`, and `https://claude.com/...` beside it), to ChatGPT (`https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/*`), or to localhost and loopback, as Claude Code does.
4. `wrangler deploy` makes the Worker and its Durable Object classes, with `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `JURISDICTION` and `AGENT_MODEL` as vars, set afresh each time, and `AGENT_API_KEY` as a secret. A key taken out of the configuration is deleted from the Worker, which then has no Agent.
5. On a first deploy, a second `pulumi up` binds the hostname to the Worker, which makes its DNS record.

Never run `wrangler deploy` by hand against a Deployment. Without the vars the deploy gives, the Worker would lose its Access application and its jurisdiction, and name its objects where none of them are.

## The jurisdiction

Cloudflare can keep every Durable Object, and so all of a Deployment's data, inside one jurisdiction: `eu`, `us` or `fedramp`. Without one, it places them where it likes. It is chosen once. A Worker naming its objects in another jurisdiction would find none of them, so `pulumi up` reads the jurisdiction the deployed Worker runs with and fails before changing anything when the configuration names another. The way to move is an Export restored into a new Deployment.

workerd does not implement jurisdictions, so no test runs with one. Every object is made or named in `apps/worker/src/routing.ts` (`lint/outside-jurisdiction.grit` holds the rest of the Worker to it), and a Deployment that chose one is where it is seen working.

## CI's sign-in to Pulumi Cloud

GitHub holds no Pulumi token. The `deploy` job signs in through GitHub OIDC (`pulumi/auth-actions`, pinned by commit). Pulumi Cloud exchanges the job's GitHub ID token for a half-hour personal access token of the Pulumi user in the `PULUMI_CI_USER` secret. It's a secret so that GitHub masks the login in the public logs, and the job fails unless `pulumi whoami` is that user. A personal token is the only kind of OIDC token every Pulumi edition offers, and it carries all of that user's Pulumi permissions in every organization the user belongs to. The narrowest identity is therefore a Pulumi user that belongs only to the stack's organization.

GitHub Actions is an OIDC issuer of the Pulumi organization, which other repositories may share. The allow policy on it requires every claim of this repository's deploy job on a push to master: the organization's audience, the numeric repository and owner IDs, the subject, `refs/heads/master`, the `push` event, `.github/workflows/ci.yml` on master and a GitHub-hosted runner. So pull requests, forks, other branches and runs started by hand get nothing. `ciTrustPolicies` in `scripts/trust-pulumi-ci.ts` is that list of claims. The script registers the issuer if there is none, replaces only this repository's allow policy, and keeps every other policy:

```sh
bun run trust:pulumi-ci --org <org> --user "$(pulumi whoami)" --dry-run   # then without --dry-run
```

To stop CI signing in at once, remove this repository's allow policy (Pulumi Cloud → Settings → Access Management → OIDC Issuers → `github-actions` → Policies). Never remove the issuer itself, since other repositories may use it.

## Changing the configuration

A key, the model, who may sign in: change the ESC environment (`pulumi env edit <org>/praxis/production`, or re-run the wizard), then deploy by pushing to master or re-running the last push's CI run.
