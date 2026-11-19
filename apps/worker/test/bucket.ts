import { env } from "cloudflare:workers";

// The bucket the Backups are kept in is real in tests, R2 as workerd runs it, not a fake. A test
// reads what is kept there through here, and can make it refuse to keep anything, as an outage
// would, to see what a failed Backup leaves: the test Worker's Deployment object holds the
// refusable bucket in place of the bucket (test/worker.ts). Each test file has a bucket of its own,
// which its tests share.

let refusing = false;

/** Make the bucket refuse every Backup, or keep them again. Each test starts with it keeping. */
export function setBucketRefusing(to: boolean): void {
  refusing = to;
}

/** The bucket, refusing to keep anything while a test says so. */
export function refusableBucket(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      if (property === "put" && refusing) {
        return async () => {
          throw new Error("The bucket refused to keep the Backup, as the test asked.");
        };
      }
      const found = Reflect.get(target, property);
      return typeof found === "function" ? found.bind(target) : found;
    },
  });
}

/** Every Backup in the bucket by its name, in name order, with its bytes. */
export async function keptBackups(): Promise<Map<string, Uint8Array>> {
  const listed = await env.BACKUPS.list();
  const found = new Map<string, Uint8Array>();
  for (const { key } of listed.objects) {
    const object = await env.BACKUPS.get(key);
    if (object) found.set(key, new Uint8Array(await object.arrayBuffer()));
  }
  return found;
}

/** Empty the bucket, so a test starts with none kept. */
export async function emptyBucket(): Promise<void> {
  const listed = await env.BACKUPS.list();
  if (listed.objects.length > 0) await env.BACKUPS.delete(listed.objects.map((o) => o.key));
}
