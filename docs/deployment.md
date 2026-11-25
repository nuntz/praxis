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
3. Has you make a Cloudflare API token for Pulumi and Wrangler, with these permissions on your account and zone: Account · Workers Scripts · Edit; Account · Access: Apps and Policies · Edit; Account · Access: Organizations, Identity Providers, and Groups · Edit; Account · Workers R2 Storage · Edit; Account · Vectorize · Edit; Zone · Workers Routes · Edit; Zone · DNS · Edit. A Deployment set up before the daily Backup needs Workers R2 Storage added to its token, or `pulumi up` cannot make the bucket; one set up before search by meaning needs Vectorize added, or it cannot make the meaning index.
4. Has you make a Google OAuth client for Access's Google sign-in.
5. Takes your Google address, the only one that signs in.
6. Takes the Agent's key and model, both optional, checks the model is one Praxis ships a price for, and says to set a spend limit with Anthropic. It makes the Web Push signing key pair, once (`apps/worker/scripts/push-keys.ts`), and keeps it on every run after: each browser's subscription to Notifications is bound to its public key.
7. Offers the jurisdiction, once (below).
8. Writes the ESC environment `<org>/praxis/production` and the stack `<org>/praxis/production`, whose gitignored stack file only imports the environment.
9. Sets up CI's sign-in to Pulumi Cloud (below), and the `CLOUDFLARE_API_TOKEN` and `PULUMI_CI_USER` secrets and the `PULUMI_STACK` and `PULUMI_ESC_ENVIRONMENT` variables.
10. Starts a deploy and watches it, then opens Praxis. You sign in through Access, make your first Context (its name, time zone and accent colour) and record an Entry, or restore an Export or a Backup in its place (below). The monthly spend cap starts at 20 US dollars: Settings → Spend changes it.

`infra/Pulumi.example.yaml` names every setting, for editing the ESC environment by hand.

## What a deploy does

The `deploy` job in `.github/workflows/ci.yml` runs after the checks pass, on a push to master, once `PULUMI_STACK` is set:

1. Signs in to Pulumi Cloud through OIDC and masks every configuration value, since the logs are public.
2. Checks that a Backup from the last day is in the bucket (see Upgrades, below), and that the model is one Praxis ships a price for, so a deploy without either fails before anything changes.
3. `pulumi up` (`infra/index.ts`): Google as an identity provider, an Access policy for you, and one Access application for the hostname, with managed OAuth on. That lets in MCP clients that register themselves and come back to Claude (`https://claude.ai/api/mcp/auth_callback`, and `https://claude.com/...` beside it), to ChatGPT (`https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/*`), or to localhost and loopback, as Claude Code does. It also makes the R2 bucket `praxis-backups`, in the Deployment's jurisdiction, where the daily Backup is kept (below), and the Vectorize index `praxis-meaning` (`infra/meaning-index.ts`), where search by meaning keeps each Context's Entries as embeddings. Vectorize keeps no index in a jurisdiction.
4. `wrangler deploy` makes the Worker and its Durable Object classes, with `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `SIGN_IN_EMAIL` (your Google address), `JURISDICTION`, `AGENT_MODEL`, `PUSH_PUBLIC_KEY` and `PUSH_SUBJECT` (the Deployment's own address, which push services are told sends its Notifications) as vars, set afresh each time, with `RELEASE`, the commit deployed, and `AGENT_API_KEY`, `VOICE_API_KEY` and `PUSH_PRIVATE_KEY` as secrets. A key taken out of the configuration is deleted from the Worker, which then has no Agent, no way to start a Call, or sends no Notification. It deploys `wrangler.deploy.json`, which `scripts/deploy-config.ts` writes from `wrangler.jsonc` with the bucket bound in the Deployment's jurisdiction, since a binding names its bucket's, and with Workers AI and the meaning index bound. `wrangler.jsonc` binds neither, since a binding to them reaches the account even in tests and on this machine: there, search finds by words alone and says so.
5. On a first deploy, a second `pulumi up` binds the hostname to the Worker, which makes its DNS record.

Never run `wrangler deploy` by hand against a Deployment. Without the vars the deploy gives, the Worker would lose its Access application and its jurisdiction, and name its objects where none of them are.

## The jurisdiction

Cloudflare can keep every Durable Object, and so all of a Deployment's data, inside one jurisdiction: `eu`, `us` or `fedramp`. Without one, it places them where it likes. It is chosen once. A Worker naming its objects in another jurisdiction would find none of them, so `pulumi up` reads the jurisdiction the deployed Worker runs with and fails before changing anything when the configuration names another. The way to move is an Export restored into a new Deployment.

The bucket of Backups is made in the same jurisdiction, and R2's default without one.

workerd does not implement jurisdictions, so no test runs with one. Every object is made or named in `apps/worker/src/routing.ts` (`lint/outside-jurisdiction.grit` holds the rest of the Worker to it), and a Deployment that chose one is where it is seen working.

## Backups

Once a day, at 03:00 UTC, the Worker's trigger makes a Backup: the same zip as an Export, `praxis-export-YYYY-MM-DD.zip`, in the `praxis-backups` bucket on your own account. The Worker deletes each one 30 days after it was made, on a day whose Backup failed too. Settings shows when the last one was made, and after three days with none made a standing Notice says so in Attention and in settings. A Backup is downloaded from the bucket in the Cloudflare dashboard (R2 → `praxis-backups`), and is restored as an Export is: whole, into a new Deployment, during setup.

## Restoring an Export

A Deployment comes back from an Export, or a Backup, in one way only: whole, into a new Deployment that holds nothing yet (SPEC section 10.2, ADR 0018). Set the new Deployment up with the wizard, and when Praxis asks you to make your first Context, choose **Restore an Export** below it instead and give it the zip, as downloaded or as kept in the bucket. Every Context comes back with its Journal, its Versions, its Trash and its Run records; each Connection comes back ended, to be made again at the new address; Devices, Conversations and the change log do not come back, since the file holds none of them. A Deployment that holds a Context, a Connection or a spend cap refuses it: there is no merge, and no restoring one Context.

### Point-in-time recovery, the operator's escape hatch

The platform keeps each object's storage for 30 days back, and can return one object to any moment in them. That is not a feature of Praxis, and nothing on the screen reaches it: it takes code deployed for the purpose, which asks that object's storage for the bookmark of the moment (`ctx.storage.getBookmarkForTime(time)`, or the one an upgrade noted, below), calls `ctx.storage.onNextSessionRestoreBookmark(bookmark)` and aborts the object, then a release without that code. The object loses whatever it did since that moment, and nothing else is returned with it: the Deployment object's list, the meaning index and the Backups stay as they are, so a Context returned past a move or a rename disagrees with them. It does not survive a deleted object, a lost account or a mistake noticed after 30 days, which is what an Export and the daily Backup are for.

## Upgrades

Every push to master is a release, named by its commit (SPEC section 11, ADR 0019). Each object, a Context's or the Deployment's own, upgrades its tables as it wakes, by a ladder of numbered steps, before it serves anything. There is no going back once an object has woken under a release: a mistake is fixed by pushing a fix.

- **The deploy checks for a Backup first.** Before anything changes, the `deploy` job looks in the bucket for the Backup the daily trigger was last due to make, today's after 03:00 UTC and yesterday's before. Without it the deploy stops with an error. Make an Export from settings, then push a commit whose message has the line `Deploy-Without-Backup: yes` to deploy anyway. That line goes past a missing Backup only: when the check cannot read the bucket, as with a token without Workers R2 Storage, the deploy stops whatever the commit says, and the token or the API comes first. A first deploy has nothing to check.
- **A Context stuck on its upgrade** shows and changes nothing, and its Brief, Review and Trash wait. Every other Context names it in a standing Notice and works as before. The last Backup that holds it is kept past its 30 days. Pushing a release that mends it, a new step and never an edit of a released one, lets it try again the next time anything reaches it.
- **A Deployment object stuck on its upgrade** means nothing can be reached: every request shows one page saying the upgrade failed and under which release. It is mended the same way.
- **The point-in-time bookmark.** Before its first pending step, each object notes the platform's point-in-time bookmark, as it stood then, in its `ladder` table and in the logs (`"upgrade":"climbing"`). Returning that one object to that moment is an operator's escape hatch, not a feature: it takes code deployed for the purpose, calling `ctx.storage.onNextSessionRestoreBookmark(bookmark)` in that object, and loses whatever the object did since.

A release that adds a step adds its file to `apps/worker/src/steps/` with the next number, with its hash in `released.json` there, and commits the fixture its ladders now need: `bun run --cwd apps/worker fixture` fills a Deployment and a Context by a fixed scenario and saves their tables beside the Export they made, under `apps/worker/test/fixtures/`. The upgrade test wakes every fixture under the current code.

## CI's sign-in to Pulumi Cloud

GitHub holds no Pulumi token. The `deploy` job signs in through GitHub OIDC (`pulumi/auth-actions`, pinned by commit). Pulumi Cloud exchanges the job's GitHub ID token for a half-hour personal access token of the Pulumi user in the `PULUMI_CI_USER` secret. It's a secret so that GitHub masks the login in the public logs, and the job fails unless `pulumi whoami` is that user. A personal token is the only kind of OIDC token every Pulumi edition offers, and it carries all of that user's Pulumi permissions in every organization the user belongs to. The narrowest identity is therefore a Pulumi user that belongs only to the stack's organization.

GitHub Actions is an OIDC issuer of the Pulumi organization, which other repositories may share. The allow policy on it requires every claim of this repository's deploy job on a push to master: the organization's audience, the numeric repository and owner IDs, the subject, `refs/heads/master`, the `push` event, `.github/workflows/ci.yml` on master and a GitHub-hosted runner. So pull requests, forks, other branches and runs started by hand get nothing. `ciTrustPolicies` in `scripts/trust-pulumi-ci.ts` is that list of claims. The script registers the issuer if there is none, replaces only this repository's allow policy, and keeps every other policy:

```sh
bun run trust:pulumi-ci --org <org> --user "$(pulumi whoami)" --dry-run   # then without --dry-run
```

To stop CI signing in at once, remove this repository's allow policy (Pulumi Cloud → Settings → Access Management → OIDC Issuers → `github-actions` → Policies). Never remove the issuer itself, since other repositories may use it.

## Changing the configuration

A key, the model, your Google address: change the ESC environment (`pulumi env edit <org>/praxis/production`, or re-run the wizard), then deploy by pushing to master or re-running the last push's CI run.
