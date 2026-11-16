/**
 * A comment naming a ticket, such as "nothing is counted yet (#49)", is a placeholder: it stands
 * until that ticket is built, and the ticket's work replaces it. This finds each placeholder in the
 * code and fails while one names a closed ticket, so none outlives its ticket. CI runs it with a
 * token for `gh`; run it by hand with `bun run check:tickets`.
 */

/** A ticket named in a comment, where. */
export type Placeholder = { file: string; line: number; ticket: number };

/** The comment on a line: after `//` at its start or after a space, or a block comment's line. */
function commentOf(line: string): string | null {
  const trimmed = line.trim();
  if (/^(\/\*|\*|\{\/\*)/.test(trimmed)) return trimmed;
  const slashes = /(?:^|\s)\/\/(.*)$/.exec(line);
  return slashes?.[1] ?? null;
}

/** Each ticket a source file's comments name, as `#N` after a space or an opening bracket. */
export function placeholdersIn(file: string, source: string): Placeholder[] {
  return source.split("\n").flatMap((text, index) => {
    const comment = commentOf(text);
    if (comment === null) return [];
    return [...comment.matchAll(/(?<=^|[\s(])#(\d+)\b/g)].map((match) => ({
      file,
      line: index + 1,
      ticket: Number(match[1]),
    }));
  });
}

async function main(): Promise<void> {
  const files = Bun.spawnSync(["git", "ls-files", "*.ts", "*.tsx"]).stdout.toString().split("\n");
  const found: Placeholder[] = [];
  // The tests of this check name tickets as samples, not as placeholders.
  for (const file of files.filter((each) => each && each !== "lint/tickets.test.ts")) {
    found.push(...placeholdersIn(file, await Bun.file(file).text()));
  }

  const closed = new Set<number>();
  for (const ticket of new Set(found.map((each) => each.ticket))) {
    const view = Bun.spawnSync(["gh", "issue", "view", String(ticket), "--json", "state"]);
    if (view.exitCode !== 0) throw new Error(`gh could not read #${ticket}: ${view.stderr}`);
    if (JSON.parse(view.stdout.toString()).state === "CLOSED") closed.add(ticket);
  }

  const stale = found.filter((each) => closed.has(each.ticket));
  for (const { file, line, ticket } of stale) {
    console.error(`${file}:${line} names #${ticket}, which is closed: do what it waited for.`);
  }
  console.log(
    `${found.length} placeholders, naming ${new Set(found.map((f) => f.ticket)).size} tickets.`,
  );
  if (stale.length > 0) process.exit(1);
}

if (import.meta.main) await main();
