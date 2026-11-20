// The Pulumi program of a Praxis Deployment on the person's own Cloudflare account (section 12):
// the Access application every caller signs in through, with managed OAuth for MCP clients
// (ADR 0009), the R2 bucket the daily Backups are kept in, the Vectorize index search by meaning
// keeps its embeddings in, the Worker's configuration and its hostname. Every value comes from the Deployment's
// Pulumi ESC environment, never from this repo; Pulumi.example.yaml names them. The Worker's code
// and its Durable Object classes deploy with `wrangler deploy` after this, given the vars and
// secrets it exports (.github/workflows/ci.yml).
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { deployedJurisdiction, jurisdictionRefusal } from "./jurisdiction.ts";
import { MeaningIndex } from "./meaning-index.ts";

// Copies, as Node cannot read wrangler.jsonc's comments: copies.test.ts keeps them in step.
const WORKER_NAME = "praxis";
const BACKUP_BUCKET = "praxis-backups";
const MEANING_INDEX = "praxis-meaning";
/** How long each embedding of the model the Worker embeds Entries with is. */
const MEANING_DIMENSIONS = 1024;

/**
 * Where the hosted clients the spec promises send the person back after sign-in (section 7.1):
 * Claude's apps, at the address Anthropic says it may move to as well, and ChatGPT, whose
 * connectors each have their own address under one path, hence the wildcard. Claude Code and
 * other local clients come back to localhost or loopback, which are allowed on their own.
 */
const HOSTED_CLIENT_REDIRECTS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chatgpt.com/connector/oauth/*",
];

const config = new pulumi.Config("praxis");
const accountId = config.require("accountId");
const zone = config.require("zone");
const hostname = config.require("hostname");
const accessTeamDomain = config.require("accessTeamDomain");
const allowedEmails = config.getObject<string[]>("allowedEmails") ?? [];
const allowedEmailDomain = config.get("allowedEmailDomain");
// Both optional: without a key there is no Agent, and without a model the Worker's default.
const agentApiKey = config.getSecret("agentApiKey");
const agentModel = config.get("agentModel");
// The Web Push signing key pair the wizard makes once. Without it no Device can switch
// Notifications on.
const pushPublicKey = config.get("pushPublicKey") ?? "";
const pushPrivateKey = config.getSecret("pushPrivateKey");
// Optional, and chosen once: none when left out.
const jurisdiction = config.get("jurisdiction") ?? "";

if (allowedEmails.length === 0 && !allowedEmailDomain) {
  throw new Error(
    "Set praxis:allowedEmails or praxis:allowedEmailDomain: otherwise no one can sign in.",
  );
}

const deployed = await deployedWorkerSettings();
const refusal = jurisdictionRefusal({
  deployed: deployed === null ? null : deployedJurisdiction(deployed),
  configured: jurisdiction,
});
if (refusal !== null) throw new Error(refusal);

// The person signs in with Google, through Access, wherever they come from.
const google = new cloudflare.ZeroTrustAccessIdentityProvider("google", {
  accountId,
  name: "Google",
  type: "google",
  config: {
    clientId: config.require("googleClientId"),
    clientSecret: config.requireSecret("googleClientSecret"),
  },
});

const person = new cloudflare.ZeroTrustAccessPolicy("person", {
  accountId,
  name: "Praxis: the person",
  decision: "allow",
  includes: [
    ...allowedEmails.map((email) => ({ email: { email } })),
    ...(allowedEmailDomain ? [{ emailDomain: { domain: allowedEmailDomain } }] : []),
  ],
});

// One application for the whole hostname: the screen, the tool endpoint and MCP (section 7.1).
// Access is the OAuth server MCP clients sign in through, so the Worker holds no OAuth code.
const application = new cloudflare.ZeroTrustAccessApplication("praxis", {
  accountId,
  name: "Praxis",
  type: "self_hosted",
  domain: hostname,
  allowedIdps: [google.id],
  autoRedirectToIdentity: true,
  sessionDuration: "720h",
  policies: [{ id: person.id, precedence: 1 }],
  oauthConfiguration: {
    enabled: true,
    dynamicClientRegistration: {
      enabled: true,
      allowedUris: HOSTED_CLIENT_REDIRECTS,
      allowAnyOnLocalhost: true,
      allowAnyOnLoopback: true,
    },
  },
});

// Where the daily Backups are kept (section 10.1), in the Deployment's jurisdiction like its
// objects; R2's own default without one. The Worker deletes each after 30 days itself, since the
// last one holding a Context stuck on an upgrade is kept longer (section 10.5), which no lifecycle
// rule can say. `wrangler deploy` binds it, so it is made first.
new cloudflare.R2Bucket("backups", {
  accountId,
  name: BACKUP_BUCKET,
  jurisdiction: jurisdiction || "default",
});

// Where each Context's Entries are kept as embeddings for search by meaning (section 9.4). Vectorize
// keeps no index in a jurisdiction: it is on the person's own account, wherever Cloudflare keeps
// it. `wrangler deploy` binds it, so it is made first.
new MeaningIndex("meaning", {
  accountId,
  name: MEANING_INDEX,
  dimensions: MEANING_DIMENSIONS,
  metric: "cosine",
});

// The custom domain needs the Worker, which `wrangler deploy` makes, so a first deploy binds the
// hostname on a second `pulumi up`. It makes the hostname's DNS record too.
const domain =
  deployed === null
    ? undefined
    : new cloudflare.WorkersCustomDomain("hostname", {
        accountId,
        hostname,
        service: WORKER_NAME,
        zoneName: zone,
      });

/** For the deploy: the account `wrangler deploy` deploys to. */
export const cloudflareAccountId = pulumi.secret(accountId);
/**
 * For the deploy: the Worker's vars, given with `--var`. None is a secret, but the deploy's logs
 * are public, so they are masked. A deploy sets every var afresh, so a model taken out of the
 * configuration falls back to the default, and JURISDICTION can be read back by the next deploy.
 */
export const workerVars = pulumi.secret(
  application.aud.apply((aud) => ({
    ACCESS_TEAM_DOMAIN: `https://${accessTeamDomain}`,
    ACCESS_AUD: aud,
    JURISDICTION: jurisdiction,
    AGENT_MODEL: agentModel ?? "",
    PUSH_PUBLIC_KEY: pushPublicKey,
    // Who the push services are told sends a Notification: the Deployment's own address.
    PUSH_SUBJECT: `https://${hostname}`,
  })),
);
/**
 * For the deploy: the Worker's secrets, given with `--secrets-file` (configuration.d.ts). That
 * only adds, so the deploy deletes a key taken out of the configuration itself.
 */
export const workerSecrets = pulumi.secret(
  pulumi.all([agentApiKey, pushPrivateKey]).apply(([key, push]) => ({
    ...(key ? { AGENT_API_KEY: key } : {}),
    ...(push ? { PUSH_PRIVATE_KEY: push } : {}),
  })),
);
export const hostnameBound = domain !== undefined;

/**
 * The deployed Worker's settings, as the Cloudflare API answers them, or null when it is not
 * deployed. Anything but a clear answer fails the update: guessing "not deployed" would unbind a
 * live hostname and let the jurisdiction change.
 */
async function deployedWorkerSettings(): Promise<object | null> {
  const configured = new pulumi.Config("cloudflare").getSecret("apiToken");
  const token = configured ? await secretValue(configured) : process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Set CLOUDFLARE_API_TOKEN so Pulumi can reach Cloudflare.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/settings`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Cloudflare refused CLOUDFLARE_API_TOKEN (HTTP ${response.status}): make one with the permissions docs/deployment.md lists.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not tell whether the ${WORKER_NAME} Worker is deployed: HTTP ${response.status}. Try the deploy again shortly.`,
    );
  }
  return (await response.json()) as object;
}

function secretValue(secret: pulumi.Output<string>): Promise<string> {
  return new Promise((resolve) => secret.apply(resolve));
}
