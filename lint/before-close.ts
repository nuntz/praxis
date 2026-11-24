/**
 * Claude Code runs this before each shell command (.claude/settings.json). Before a command closes
 * a ticket, it runs the ticket check with that ticket counted as closing, and refuses the command
 * while a comment still names it: closing would leave master's check red, and the warning the
 * Ticket closed workflow posts on the ticket comes only after, which twice went unseen.
 */

/** The options of `gh issue close` that take a value as their next word. */
const TAKES_A_VALUE = new Set([
  "-c",
  "--comment",
  "-r",
  "--reason",
  "-R",
  "--repo",
  "--duplicate-of",
]);

/** The words of a shell command, quoted ones whole, and each run of `;`, `&` or `|` as a word. */
function wordsOf(command: string): string[] {
  return command.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[;&|]+|[^\s;&|]+/g) ?? [];
}

/** The ticket a shell command closes with `gh issue close`, or null if it closes none. */
export function ticketClosedBy(command: string): number | null {
  const words = wordsOf(command);
  for (let at = 0; at + 2 < words.length; at++) {
    if (words[at] !== "gh" || words[at + 1] !== "issue" || words[at + 2] !== "close") continue;
    for (let next = at + 3; next < words.length; next++) {
      const word = words[next] ?? "";
      if (/^[;&|]/.test(word)) break;
      if (TAKES_A_VALUE.has(word)) {
        next++;
        continue;
      }
      if (word.startsWith("-")) continue;
      const ticket = /^(?:https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/)?(\d+)$/.exec(word);
      return ticket ? Number(ticket[1]) : null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const payload = JSON.parse(await Bun.stdin.text()) as { tool_input?: { command?: unknown } };
  const command = payload.tool_input?.command;
  const ticket = typeof command === "string" ? ticketClosedBy(command) : null;
  if (ticket === null) return;

  const check = Bun.spawnSync(["bun", "lint/tickets.ts", "--closing", String(ticket)], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  });
  if (check.exitCode === 0) return;
  // Exit code 2 refuses the command, and Claude Code shows the agent what is written here.
  console.error(
    `Not closing #${ticket} yet: the ticket check fails with it closed.\n` +
      `${check.stdout}${check.stderr}\n` +
      "Clear each comment it names, as the ticket's work replaces it, then close it.",
  );
  process.exit(2);
}

if (import.meta.main) await main();
