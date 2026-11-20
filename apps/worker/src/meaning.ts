/**
 * The meaning index (section 9.4, ADR 0023): embeddings of each Context's Entries by Workers AI,
 * kept in Vectorize, both on the person's own account. One of the faked things (section 13): the
 * real one is the Deployment's bindings, and tests put a fake in its place. Either way it is told
 * which Context each call is for, and keeps each Context's part apart from every other's.
 */
export interface MeaningIndex {
  /** The embedding of each text, in order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Put each Entry's embedding in the Context's part of the index, in place of any it had. */
  put(context: string, embeddings: { entry: string; embedding: number[] }[]): Promise<void>;
  /** Take these Entries out of the Context's part of the index. */
  remove(context: string, entries: string[]): Promise<void>;
  /**
   * The Entries nearest an embedding in the Context's part of the index, nearest first, at most
   * `count`, each with how alike they are: 1 the same, 0 nothing in common.
   */
  nearest(
    context: string,
    embedding: number[],
    count: number,
  ): Promise<{ entry: string; likeness: number }[]>;
}

/**
 * The embedding model, fixed in code and never configuration: a release that changes it marks every
 * meaning index stale, and each is rebuilt from its Journal (section 9.4). Chosen because it
 * handles Entries in more than one language.
 */
export const MEANING_MODEL = "@cf/baai/bge-m3";

/** How long each of the model's embeddings is, which the Vectorize index is made for. */
export const MEANING_DIMENSIONS = 1024;

/**
 * What the model costs on Workers AI, in US dollars per million tokens embedded, by its published
 * price, so embedding counts toward the cap (section 5.7). Workers AI does not say how many tokens
 * a call took, so they are reckoned from the words' length.
 */
export const MEANING_PRICE = 0.012;

/**
 * How alike an Entry must be to what was searched for to be found by meaning, by the model's
 * measure. Nearest is not near: without it every search would list the nearest Entries however
 * far they are. The contract suite run by hand checks it against the real model.
 */
export const LIKE_ENOUGH = 0.5;

/** The most Entries a search asks the meaning index for. */
export const NEAREST = 50;

/**
 * How many Entries are taken out of the meaning index in one call when the Context is deleted, some
 * of them never put in. The contract suite run by hand checks Vectorize takes that many at once.
 */
export const MEANING_REMOVAL_BATCH = 100;

/**
 * The tokens embedding these texts is reckoned to take: one for every three UTF-16 code units,
 * which overcounts English and is near for the other languages the model reads.
 */
export function tokensOf(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 3), 0);
}

/** What embedding these texts costs, in US dollars. */
export function embeddingCost(texts: string[]): number {
  return (tokensOf(texts) * MEANING_PRICE) / 1_000_000;
}

/**
 * The Vectorize id of an Entry's embedding in a Context's part of the index. Ids are unique across
 * the whole index, not within one part, and an Entry keeps its id when it moves between Contexts,
 * so each id starts with the Context's: 16 of its 64 hex digits, which tell a Deployment's few
 * Contexts apart, so the id stays within Vectorize's 64 bytes.
 */
export function embeddingId(context: string, entry: string): string {
  return `${context.slice(0, 16)}.${entry}`;
}

/** The Entry an embedding's Vectorize id names. */
export function entryOfEmbedding(id: string): string {
  return id.slice(id.indexOf(".") + 1);
}

/** The bindings the deploy gives the Worker for the meaning index (scripts/deploy-config.ts). */
export type MeaningBindings = { AI?: Ai; MEANING?: Vectorize };

/**
 * The meaning index on the Deployment's own bindings, or null when it has none: `wrangler.jsonc`
 * binds neither, since a binding to Workers AI or Vectorize reaches the account even in tests and
 * on this machine, and the deploy adds both. Without them search answers from words, and says so.
 */
export function workersAiMeaning(env: MeaningBindings): MeaningIndex | null {
  const { AI: ai, MEANING: vectors } = env;
  if (!ai || !vectors) return null;
  return {
    async embed(texts) {
      const answer = await ai.run(MEANING_MODEL, { text: texts, truncate_inputs: true });
      const data = "data" in answer ? answer.data : undefined;
      if (!data || data.length !== texts.length) {
        throw new Error(`${MEANING_MODEL} gave no embedding for each text`);
      }
      return data;
    },
    async put(context, embeddings) {
      if (embeddings.length === 0) return;
      await vectors.upsert(
        embeddings.map(({ entry, embedding }) => ({
          id: embeddingId(context, entry),
          values: embedding,
          namespace: context,
        })),
      );
    },
    async remove(context, entries) {
      if (entries.length === 0) return;
      await vectors.deleteByIds(entries.map((entry) => embeddingId(context, entry)));
    },
    async nearest(context, embedding, count) {
      const { matches } = await vectors.query(embedding, {
        topK: count,
        namespace: context,
        returnValues: false,
        returnMetadata: "none",
      });
      return matches.map((match) => ({ entry: entryOfEmbedding(match.id), likeness: match.score }));
    },
  };
}
