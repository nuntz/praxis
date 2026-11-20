import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import {
  embeddingId,
  LIKE_ENOUGH,
  MEANING_DIMENSIONS,
  MEANING_REMOVAL_BATCH,
  type MeaningBindings,
  type MeaningIndex,
  workersAiMeaning,
} from "../src/meaning.ts";
import { fakeMeaning, meanAlike } from "./meaning-fake.ts";

// The meaning index's one contract suite (section 13). In CI it runs against the fake. By hand it
// runs against Workers AI and a Vectorize index on the person's own account as well, which no
// test or CI run otherwise reaches (wrangler.jsonc binds neither):
//
//   bunx wrangler vectorize create praxis-meaning-contract --dimensions=1024 --metric=cosine
//   bun run --cwd apps/worker test:meaning
//
// That run binds both remotely (test/meaning.wrangler.jsonc), so it costs a little. It is what
// checks LIKE_ENOUGH against the real model: alike words are found and unrelated ones are not.

type Service = {
  index: MeaningIndex;
  /** Say these words mean alike, where the index needs telling: the fake does, the model does not. */
  meanAlike: (...words: string[]) => void;
  /**
   * Read until `done` says the answer is the one wanted, as Vectorize takes in a change some
   * seconds after it is made; the fake has taken it in at once.
   */
  eventually: <T>(read: () => Promise<T>, done: (answer: T) => boolean) => Promise<T>;
};

/** A Context's id as the platform makes one: 64 hex digits, new for each test. */
function contextId(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const ABOUT_TEETH = "Booked a check-up with the dentist for the tooth that aches";
const ABOUT_GARDEN = "Planted tulip bulbs along the garden fence before the frost";

function contract(name: string, service: () => Service) {
  describe(`the meaning index: ${name}`, () => {
    test("embeds each text, in order, as long as the index is made for", async () => {
      const { index } = service();
      const embeddings = await index.embed([ABOUT_TEETH, ABOUT_GARDEN]);

      expect(embeddings.map((embedding) => embedding.length)).toEqual([
        MEANING_DIMENSIONS,
        MEANING_DIMENSIONS,
      ]);
    });

    test("finds what is alike enough, and leaves out what is not", async () => {
      const { index, meanAlike, eventually } = service();
      meanAlike("dentist", "tooth", "teeth");
      const context = contextId();
      const [teeth, garden, asked] = await index.embed([ABOUT_TEETH, ABOUT_GARDEN, "teeth"]);
      await index.put(context, [
        { entry: "teeth", embedding: teeth ?? [] },
        { entry: "garden", embedding: garden ?? [] },
      ]);

      const nearest = await eventually(
        () => index.nearest(context, asked ?? [], 10),
        (found) => found.length === 2,
      );

      expect(nearest.map(({ entry }) => entry)).toEqual(["teeth", "garden"]);
      expect(nearest[0]?.likeness).toBeGreaterThanOrEqual(LIKE_ENOUGH);
      expect(nearest[1]?.likeness).toBeLessThan(LIKE_ENOUGH);
      await index.remove(context, ["teeth", "garden"]);
    });

    test("takes an embedding's id and its Context's part at their longest: a Context's 64-digit id and an Entry's UUID", async () => {
      const { index, eventually } = service();
      const context = contextId();
      const entry = crypto.randomUUID();
      expect(new TextEncoder().encode(embeddingId(context, entry)).length).toBeLessThanOrEqual(64);
      const [embedding] = await index.embed([ABOUT_GARDEN]);
      await index.put(context, [{ entry, embedding: embedding ?? [] }]);

      const nearest = await eventually(
        () => index.nearest(context, embedding ?? [], 10),
        (found) => found.length === 1,
      );
      expect(nearest.map((found) => found.entry)).toEqual([entry]);
      await index.remove(context, [entry]);
    });

    test("takes out as many Entries at once as deleting a Context does, some never put in", async () => {
      const { index, eventually } = service();
      const context = contextId();
      const [garden, teeth] = await index.embed([ABOUT_GARDEN, ABOUT_TEETH]);
      const put = [crypto.randomUUID(), crypto.randomUUID()];
      await index.put(context, [
        { entry: put[0] as string, embedding: garden ?? [] },
        { entry: put[1] as string, embedding: teeth ?? [] },
      ]);
      await eventually(
        () => index.nearest(context, garden ?? [], 10),
        (found) => found.length === 2,
      );
      const neverPut = Array.from({ length: MEANING_REMOVAL_BATCH - put.length }, () =>
        crypto.randomUUID(),
      );

      await index.remove(context, [...neverPut, ...put]);

      expect(
        await eventually(
          () => index.nearest(context, garden ?? [], 10),
          (found) => found.length === 0,
        ),
      ).toEqual([]);
    });

    test("keeps each Context's part to itself", async () => {
      const { index, meanAlike, eventually } = service();
      meanAlike("dentist", "tooth", "teeth");
      const [one, other] = [contextId(), contextId()];
      const [teeth, asked] = await index.embed([ABOUT_TEETH, "teeth"]);
      await index.put(one, [{ entry: "teeth", embedding: teeth ?? [] }]);
      await eventually(
        () => index.nearest(one, asked ?? [], 10),
        (found) => found.length === 1,
      );

      expect(await index.nearest(other, asked ?? [], 10)).toEqual([]);
      await index.remove(one, ["teeth"]);
    });

    test("puts an Entry's embedding in place of the one it had, and takes it out", async () => {
      const { index, meanAlike, eventually } = service();
      meanAlike("dentist", "tooth", "teeth");
      const context = contextId();
      const [garden, teeth, asked] = await index.embed([ABOUT_GARDEN, ABOUT_TEETH, "teeth"]);
      await index.put(context, [{ entry: "edited", embedding: garden ?? [] }]);
      await index.put(context, [{ entry: "edited", embedding: teeth ?? [] }]);

      const nearest = await eventually(
        () => index.nearest(context, asked ?? [], 10),
        (found) => (found[0]?.likeness ?? 0) >= LIKE_ENOUGH,
      );
      expect(nearest.map(({ entry }) => entry)).toEqual(["edited"]);

      await index.remove(context, ["edited"]);
      expect(
        await eventually(
          () => index.nearest(context, asked ?? [], 10),
          (found) => found.length === 0,
        ),
      ).toEqual([]);
    });
  });
}

contract("the fake", () => ({
  index: fakeMeaning,
  meanAlike,
  eventually: (read) => read(),
}));

// Bound only by the run by hand's configuration (test/meaning.wrangler.jsonc).
const real = workersAiMeaning(env as MeaningBindings);
if (real !== null) {
  contract("Workers AI and Vectorize", () => ({
    index: real,
    meanAlike: () => {},
    async eventually(read, done) {
      // Vectorize takes in a change within some seconds; a minute is past any it should take.
      for (let tries = 0; ; tries += 1) {
        const answer = await read();
        if (done(answer) || tries === 30) return answer;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    },
  }));
}
