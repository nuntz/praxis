import { publishedKeySet } from "./access.ts";
import { contextObject } from "./context-object.ts";
import { deploymentObject } from "./deployment-object.ts";
import { workersAiMeaning } from "./meaning.ts";
import { anthropicModel } from "./model.ts";
import { webPush } from "./push.ts";
import { openAiVoice } from "./voice.ts";
import { praxis } from "./worker.ts";

/** The Deployment object, sending Notifications by Web Push with the Deployment's key pair. */
export const DeploymentObject = deploymentObject(webPush);
export type DeploymentObject = InstanceType<typeof DeploymentObject>;

/**
 * Each Context's object, its Agent on the model the Deployment's configuration names, its meaning
 * index on the Deployment's Workers AI and Vectorize, and its Calls set up at OpenAI's voice model
 * with the Deployment's voice key.
 */
export const ContextObject = contextObject(anthropicModel, workersAiMeaning, (env) =>
  openAiVoice(env),
);
export type ContextObject = InstanceType<typeof ContextObject>;

/** Praxis as deployed: behind the Access application its configuration names, for the person it names. */
export default praxis((env) => ({
  keySet: publishedKeySet(env.ACCESS_TEAM_DOMAIN),
  application: { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
  signInEmail: env.SIGN_IN_EMAIL,
}));
