/**
 * No words leave (section 2, principle 7). Tests seed words with markers, everything written to
 * the console is captured, and after each test the harness fails it if a marker was logged.
 */

const markers = new Set<string>();
const logged: string[] = [];

/** A string that must never appear in anything logged, to put in words. */
export function marker(): string {
  const made = `MARKER-${crypto.randomUUID()}`;
  markers.add(made);
  return made;
}

/** Words carrying a marker. */
export function marked(words: string): string {
  return `${words} ${marker()}`;
}

/** Everything logged since the last test began, one string per console call. */
export function logs(): readonly string[] {
  return logged;
}

/** The markers found in anything logged. */
export function leakedMarkers(): string[] {
  return [...markers].filter((marker) => logged.some((line) => line.includes(marker)));
}

/** Start the next test with nothing logged and no markers. */
export function forget(): void {
  markers.clear();
  logged.length = 0;
}

const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;

/** Capture every console call made in this isolate, which is where the Context objects run. */
export function captureConsole(): void {
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      logged.push(args.map(asText).join(" "));
      original(...args);
    };
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ""}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
