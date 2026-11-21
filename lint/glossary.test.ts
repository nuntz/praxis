import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The guard of the glossary's _Avoid_ lists (CODING_STANDARDS.md, Domain words): code is named with
// the glossary's terms, so a name made of a term it lists to avoid, such as `VoiceSession` for a
// Call, fails here, whatever its case or joining. Only the terms of more than one word are held to
// it: a single word such as "session" or "turn" names too much else, and stays the reviewer's. A
// term is avoided for one concept, so a name that uses it for another is listed below, with why.

const root = join(import.meta.dir, "..");

/**
 * The names that hold a term the glossary avoids for one concept and mean another by it, by the
 * term avoided. Each is a name, not the term, so the term stays avoided everywhere else.
 */
const MEANING_ANOTHER: Record<string, { names: string[]; why: string }> = {
  "API key": {
    names: [
      "AGENT_API_KEY",
      "agentApiKey",
      "ANTHROPIC_API_KEY",
      "VOICE_API_KEY",
      "voiceApiKey",
      "x-api-key",
    ],
    why: "the providers' own keys (ADR 0017), which are no Connection",
  },
  "error message": {
    names: ["errorMessage"],
    why: "the Agent's runtime's field for the provider's error, which is no Notice",
  },
};

/** Each term the glossary lists to avoid that is more than one word, with the term it avoids. */
export function avoidedIn(glossary: string): { avoided: string; term: string }[] {
  const found: { avoided: string; term: string }[] = [];
  let term = "";
  for (const line of glossary.split("\n")) {
    const named = /^\*\*(.+?)\*\*:/.exec(line);
    if (named) term = named[1] ?? "";
    const avoid = /^_Avoid_: (.*)$/.exec(line);
    if (!avoid) continue;
    for (const avoided of (avoid[1] ?? "").split(",").map((each) => each.trim())) {
      if (wordsOf(avoided).length > 1) found.push({ avoided, term });
    }
  }
  return found;
}

/** The words of a term or of a name, lowercased: `VoiceSession`, `voice_session`, "Voice session". */
export function wordsOf(text: string): string[] {
  return text
    .replace(/'/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

/** Whether a name holds these words one after the other. */
function holds(name: string[], words: string[]): boolean {
  return name.some((_, at) => words.every((word, offset) => name[at + offset] === word));
}

/** Each name in the sources made of a term the glossary avoids, as `file:line name (avoid …)`. */
export function avoidedNames(
  sources: Map<string, string>,
  avoided: { avoided: string; term: string }[],
  elsewhere: Record<string, { names: string[] }> = MEANING_ANOTHER,
): string[] {
  const found: string[] = [];
  for (const [file, source] of sources) {
    const names = [
      { line: 0, name: file.split("/").at(-1) ?? file },
      ...source.split("\n").flatMap((text, index) =>
        [...text.matchAll(/[A-Za-z_$][\w$-]*/g)].map((match) => ({
          line: index + 1,
          name: match[0],
        })),
      ),
    ];
    for (const { line, name } of names) {
      const words = wordsOf(name);
      for (const { avoided: term, term: instead } of avoided) {
        if (elsewhere[term]?.names.includes(name)) continue;
        if (words.length > 1 && holds(words, wordsOf(term))) {
          found.push(`${file}:${line} ${name} (the glossary avoids "${term}": say ${instead})`);
        }
      }
    }
  }
  return found;
}

/** The repository's own code, by path: every TypeScript file git tracks or would. */
function codeFiles(): Map<string, string> {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts", "*.tsx"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => file !== "" && file !== "lint/glossary.test.ts");
  return new Map(listed.map((file) => [file, readFileSync(join(root, file), "utf8")]));
}

describe("the glossary guard", () => {
  test("no name in the code is made of a term the glossary avoids", () => {
    const avoided = avoidedIn(readFileSync(join(root, "GLOSSARY.md"), "utf8"));

    expect(avoided.length).toBeGreaterThan(0);
    expect(avoidedNames(codeFiles(), avoided)).toEqual([]);
  });

  test("names a name made of an avoided term, however it is joined, passing over prose and a name listed as meaning another", () => {
    const avoided = avoidedIn("**Call**:\nA spoken exchange.\n_Avoid_: Voice session, voice\n");
    const sources = new Map([
      ["src/voice-session.ts", "type VoiceSession = {};\nconst voice_session = 1;"],
      [
        "src/call.ts",
        "// A voice session is a Call.\nconst voice = 1;\nconst SHARED_VOICE_SESSION = 2;",
      ],
    ]);
    const elsewhere = { "Voice session": { names: ["SHARED_VOICE_SESSION"] } };

    expect(avoided).toEqual([{ avoided: "Voice session", term: "Call" }]);
    expect(avoidedNames(sources, avoided, elsewhere)).toEqual([
      'src/voice-session.ts:0 voice-session.ts (the glossary avoids "Voice session": say Call)',
      'src/voice-session.ts:1 VoiceSession (the glossary avoids "Voice session": say Call)',
      'src/voice-session.ts:2 voice_session (the glossary avoids "Voice session": say Call)',
    ]);
  });
});
