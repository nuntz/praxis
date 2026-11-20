// The meaning index (section 9.4, ADR 0023): one Vectorize index for the Deployment, each Context's
// embeddings in a part of their own, on the person's own account. Pulumi's Cloudflare provider has
// no Vectorize resource, so this one reaches the Cloudflare API itself. The index is derived and can
// be rebuilt: a change of its shape, which a new embedding model brings, replaces it, and every
// Context rebuilds its part as it wakes under that release.
import * as pulumi from "@pulumi/pulumi";

/** The index's shape: as long as each embedding the model gives, compared by angle. */
export type IndexShape = { name: string; dimensions: number; metric: "cosine" };

/** The index as the Cloudflare API describes it. */
type Described = { name: string; config: { dimensions: number; metric: string } };

/**
 * The dynamic provider runs in a process of its own, so it reads the account's API token from the
 * environment, as `wrangler deploy` does, rather than carrying it in the stack's state.
 */
function token(): string {
  const value = process.env.CLOUDFLARE_API_TOKEN;
  if (!value) throw new Error("Set CLOUDFLARE_API_TOKEN so Pulumi can make the meaning index.");
  return value;
}

/** Ask the Cloudflare API about the account's Vectorize indexes. */
async function vectorize(accountId: string, path: string, init: RequestInit = {}) {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json" },
    },
  );
}

/** Whether an index already there is of this shape, so it can be taken as it is. */
export function sameShape(described: Described, shape: IndexShape): boolean {
  return (
    described.config.dimensions === shape.dimensions && described.config.metric === shape.metric
  );
}

type Inputs = IndexShape & { accountId: string };

const provider: pulumi.dynamic.ResourceProvider = {
  async create(inputs: Inputs) {
    const { accountId, ...shape } = inputs;
    // One made by an earlier stack, or by hand, is taken as it is when its shape is right.
    const found = await vectorize(accountId, `/${shape.name}`);
    if (found.ok) {
      const { result } = (await found.json()) as { result: Described };
      if (!sameShape(result, shape)) {
        throw new Error(
          `A Vectorize index named ${shape.name} is there with another shape: ${JSON.stringify(result.config)}. Delete it (wrangler vectorize delete ${shape.name}) and deploy again: the meaning index is rebuilt from each Journal.`,
        );
      }
      return { id: shape.name, outs: inputs };
    }
    const made = await vectorize(accountId, "", {
      method: "POST",
      body: JSON.stringify({
        name: shape.name,
        config: { dimensions: shape.dimensions, metric: shape.metric },
      }),
    });
    if (!made.ok) {
      throw new Error(
        `Cloudflare did not make the meaning index (HTTP ${made.status}): the API token needs Account · Vectorize · Edit (docs/deployment.md).`,
      );
    }
    return { id: shape.name, outs: inputs };
  },
  async diff(_id, olds: Inputs, news: Inputs) {
    const replaces = (["accountId", "name", "dimensions", "metric"] as const).filter(
      (key) => olds[key] !== news[key],
    );
    return { changes: replaces.length > 0, replaces, deleteBeforeReplace: true };
  },
  async delete(_id, olds: Inputs) {
    const deleted = await vectorize(olds.accountId, `/${olds.name}`, { method: "DELETE" });
    if (!deleted.ok && deleted.status !== 404) {
      throw new Error(`Cloudflare did not delete the meaning index (HTTP ${deleted.status}).`);
    }
  },
};

/** The Deployment's meaning index, a Vectorize index of the shape the embedding model needs. */
export class MeaningIndex extends pulumi.dynamic.Resource {
  constructor(name: string, args: Inputs, options?: pulumi.CustomResourceOptions) {
    super(provider, name, args, { deleteBeforeReplace: true, ...options });
  }
}
