// The deploy's check that a Backup from the last day exists (SPEC section 11, ADR 0019): a deploy is
// a one-way door once any object wakes under it, so the deploy stops with a warning when the Backup
// the daily trigger was last due to make is not in the bucket. The person goes on without it by
// pushing a commit whose message has the line `Deploy-Without-Backup: yes`. The deploy job
// (.github/workflows/ci.yml) asks:
//
//   bun scripts/backup-check.ts due               the name of the Backup due last, as at now
//   bun scripts/backup-check.ts in-bucket <name>  whether the bucket holds it: exits 0 if it does,
//                                                 3 if not, any other code when it cannot say
//   bun scripts/backup-check.ts overridden        whether the message on stdin says to go on
//                                                 without it
//
// `in-bucket` lists the bucket through the Cloudflare API, with the job's CLOUDFLARE_API_TOKEN and
// the account in CLOUDFLARE_ACCOUNT_ID, in the jurisdiction JURISDICTION names if it names one. It
// reads only the objects' metadata: a Backup is a whole Export (ADR 0018), and the check never
// fetches one onto the runner.

/** The line in a commit's message that deploys it without a Backup from the last day. */
export const WITHOUT_BACKUP = "Deploy-Without-Backup: yes";

/** The bucket of Backups, as infra/index.ts makes it (kept in step by infra/copies.test.ts). */
export const BACKUP_BUCKET = "praxis-backups";

/**
 * How `in-bucket` says the bucket does not hold the Backup. Not 1, which is how bun exits on any
 * uncaught error, so a script that fails is never read as a missing Backup the commit can go past.
 */
const NOT_IN_BUCKET = 3;

/** When the daily trigger fires, in UTC hours (apps/worker/wrangler.jsonc, section 10.3). */
const DUE_AT_HOUR = 3;

/**
 * The name of the Backup the daily trigger was last due to make, as at `now`: today's once 03:00
 * UTC has come, yesterday's before. A Backup is named after the day it was due (section 10.3).
 */
export function lastDueBackup(now: number): string {
  const due = new Date(now);
  if (due.getUTCHours() < DUE_AT_HOUR) due.setUTCDate(due.getUTCDate() - 1);
  return `praxis-export-${due.toISOString().slice(0, 10)}.zip`;
}

/** Whether a commit's message says to deploy it without a Backup from the last day. */
export function deploysWithoutBackup(message: string): boolean {
  return message
    .split("\n")
    .some((line) => line.trim().toLowerCase() === WITHOUT_BACKUP.toLowerCase());
}

/**
 * Whether the Cloudflare API's listing of the bucket under a Backup's name, answered with `status`
 * and `body`, holds that Backup: an object whose key is the name exactly, not one that only starts
 * with it. An answer that is not a listing throws, naming the status, so a token or API problem is
 * never taken for a missing Backup, nor waved through by the line that deploys without one.
 */
export function holdsBackup(name: string, status: number, body: string): boolean {
  let listing: {
    success?: boolean;
    result?: { key?: unknown }[];
    errors?: { message?: unknown }[];
  };
  try {
    listing = JSON.parse(body) ?? {};
  } catch {
    listing = {};
  }
  const listed =
    status >= 200 && status < 300 && listing.success === true && Array.isArray(listing.result);
  if (!listed) {
    const said = (listing.errors ?? [])
      .map((error) => error.message)
      .filter((message) => typeof message === "string");
    throw new Error(`HTTP ${status}${said.length > 0 ? `: ${said.join("; ")}` : ""}`);
  }
  return (listing.result ?? []).some((object) => object.key === name);
}

/**
 * The Cloudflare API request that lists the bucket under a Backup's name, reading the objects'
 * metadata and none of their contents. A Deployment with a jurisdiction keeps its bucket there.
 */
export function backupListing(
  name: string,
  where: { account: string; jurisdiction: string; token: string },
): { url: string; headers: Record<string, string> } {
  const { account, jurisdiction, token } = where;
  const prefix = new URLSearchParams({ prefix: name });
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BACKUP_BUCKET}/objects?${prefix}`,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : {}),
    },
  };
}

/** Whether the bucket holds the Backup `name`: 0 if it does, NOT_IN_BUCKET if not, 2 if unsure. */
async function inBucket(name: string): Promise<number> {
  const { url, headers } = backupListing(name, {
    account: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    jurisdiction: process.env.JURISDICTION ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  });
  try {
    const answer = await fetch(url, { headers });
    return holdsBackup(name, answer.status, await answer.text()) ? 0 : NOT_IN_BUCKET;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error(
      `::error::The Cloudflare API could not say whether the Backup ${name} is in the bucket (${why}). That is not a missing Backup, and '${WITHOUT_BACKUP}' does not go past it: check the CLOUDFLARE_API_TOKEN secret can read Workers R2 Storage, then run the deploy again.`,
    );
    return 2;
  }
}

if (import.meta.main) {
  const [asked, name] = process.argv.slice(2);
  if (asked === "due") {
    console.log(lastDueBackup(Date.now()));
  } else if (asked === "in-bucket") {
    if (!name) {
      console.error("Ask `in-bucket` with the Backup's name.");
      process.exit(2);
    }
    process.exit(await inBucket(name));
  } else if (asked === "overridden") {
    process.exit(deploysWithoutBackup(await Bun.stdin.text()) ? 0 : 1);
  } else {
    console.error("Ask `due`, `in-bucket <name>` or `overridden`.");
    process.exit(2);
  }
}
