/**
 * No words leave (section 2, principle 7). Tests seed words with markers, everything written to
 * the console is captured, and after each test the harness fails it if a marker was logged.
 */

const markers = new Set<string>();
const logged: string[] = [];

/**
 * A string that must never appear in anything logged, to put in words. One word to the search
 * index, so a word given last can begin it only by beginning "MARKER", and then in every run: a
 * UUID's groups of hex were each a word, which a begun "caf" or "bed" matched now and then.
 */
export function marker(): string {
  const made = `MARKER${crypto.randomUUID().replaceAll("-", "")}`;
  markers.add(made);
  return made;
}

/**
 * Words carrying a marker. Each call adds a new one, so words used twice, as written and as read
 * back, are made once and kept in a variable. The marker comes first, so a summary of the words,
 * cut at 80 characters, carries it too, and finding the marker finds either. The marker is one
 * word, at spaces and as the search index splits words, so an Entry's excerpt of 16 keeps at most
 * fifteen after it (section 9.4).
 */
export function marked(words: string): string {
  return `${marker()} ${words}`;
}

/**
 * Hold the markers in some text to the same check, as if this test had made them: words a fixture
 * saved by an earlier release carries (test/upgrade.test.ts).
 */
export function adoptMarkers(text: string): void {
  for (const found of markersIn(text)) markers.add(found);
}

/** The markers in some text, such as a record's words. */
export function markersIn(text: string): string[] {
  return text.match(MARKERS) ?? [];
}

/** A marker as made now, or as an earlier test made one and a fixture keeps it, with dashes. */
const MARKERS = /MARKER(?:[0-9a-f]{32}|-[0-9a-f-]{36})/g;

/** Everything logged or carried since the last test began, one string per console call. */
export function logs(): readonly string[] {
  return logged;
}

/**
 * Something that left Praxis other than by a log line, such as a Notification, held to the same
 * check: no marker may appear in it.
 */
export function carried(text: string): void {
  logged.push(text);
}

/** The markers found in anything logged or carried. */
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
