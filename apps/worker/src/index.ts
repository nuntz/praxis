import { publishedKeySet } from "./access.ts";
import { praxis } from "./worker.ts";

export { ContextObject } from "./context-object.ts";
export { DeploymentObject } from "./deployment-object.ts";

/** Praxis as deployed: behind the Access application its configuration names. */
export default praxis((env) => ({
  keySet: publishedKeySet(env.ACCESS_TEAM_DOMAIN),
  application: { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
}));
