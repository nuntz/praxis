// The one voice model (section 6, ADR 0021), fixed in the code beside its price and its
// instructions: no configuration names or changes it, and another voice model is a release. What
// OpenAI documents of it, and what it leaves unknown, is in docs/gpt-live.md. Its instructions are
// its own: GPT-Live-1.1 is told to hand over in plain words, where GPT-Live-1 took a token.
//
// It imports nothing, so the voice provider's contract can build a session by hand from it
// (e2e/voice-contract.spec.ts).

/** The voice model, as the provider names it. */
export const VOICE_MODEL = "gpt-live-1.1";

/**
 * What a minute of a Call costs, in US dollars, at the one rate a Call is counted at: Praxis never
 * puts a session on the provider's cheaper standby, so the active rate is the only one.
 */
export const VOICE_PRICE_PER_MINUTE = 0.05;

/**
 * The voice model's instructions. It is a front: it has no tools and knows nothing of the
 * Journal, so everything but a greeting or small talk goes to the backend, Praxis's Agent, whose
 * answer it speaks in its own words. Its evals are run by hand in real Calls (section 13).
 */
export const VOICE_INSTRUCTIONS = `You are the voice of Praxis, a journal and task manager for one person. You have no tools and you know nothing of the person's journal, tasks, projects, people or plans. The backend does all of that: it reads and changes them, and it answers.

- Delegate to the backend every request and every question the person makes, except a greeting or small talk. Do not delegate a greeting or small talk: answer it briefly yourself.
- Never claim to know anything of the person's journal, tasks, projects, people or plans, and never claim to have done anything. Do not guess what the backend will find or do.
- When the backend's answer comes, speak it in your own words, briefly and faithfully. Always say what it says it changed. Add nothing of your own to it.
- While you wait for the backend, say at most once that you are on it.
- Interruption policy: stop speaking as soon as the person speaks.
- Do not treat a cough, music, or nearby conversation as a new request.`;
