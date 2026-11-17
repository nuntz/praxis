import { publishedKeySet } from "./access.ts";
import { contextObject } from "./context-object.ts";
import { anthropicModel } from "./model.ts";
import { praxis } from "./worker.ts";

export { DeploymentObject } from "./deployment-object.ts";

/** Each Context's object, its Agent on the model the Deployment's configuration names. */
export const ContextObject = contextObject(anthropicModel);
export type ContextObject = InstanceType<typeof ContextObject>;

/** Praxis as deployed: behind the Access application its configuration names. */
export default praxis((env) => ({
  keySet: publishedKeySet(env.ACCESS_TEAM_DOMAIN),
  application: { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
}));
