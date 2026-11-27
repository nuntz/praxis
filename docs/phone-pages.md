# On a real phone

What only a real phone shows, which no journey can: iOS Safari's own layout and its on-screen keyboard. Playwright's WebKit is not iOS Safari, and its phone emulation has no keyboard (SPEC section 13).

## The real-phone loop

`scripts/phone-loop.ts` serves a build to a real phone and says, from the phone itself, whether the screen drew and whether it froze. Reach for it when a bug shows only on an iPhone, and before merging a change to `apps/pwa/src/styles.css` or a phone layout. In #187 Attention drew nothing on an iPhone while every journey passed, and Playwright's WebKit never froze on the same build and data. This loop found the commit, then the rule, in about 20 minutes.

1. **Capture the reads to replay** (optional, for a bug that needs the person's own data): ask the Praxis connector the tools the screen reads, such as `view_attention` and `list_entries`, and save each answer whole as `<tool>.json` in a folder outside the repo. They hold the person's records: never commit them.
2. **Serve a build:** `bun scripts/phone-loop.ts --replay <folder>`, with `--commit <rev>` to build a commit in a worktree of its own, and `--patch <file>` to try one change on top of it. It listens on 127.0.0.1:8787 (`--port`), and replays each `<tool>.json` as that tool's first read in every Context. The phone needs an HTTPS address of this machine that reaches that port, such as a tailnet-only serve onto it: HTTPS, as the screen needs a secure context.
3. **Open it on the phone** in a fresh tab, closing the last one first, and leave it about ten seconds.
4. **Read the verdict** in the loop's output. Each load says when it started, how many of the counted elements it drew (Attention's rows by default; `--count <selector>`), and `FROZEN, or closed unsaid` once a page shown stops beating for two seconds. A freeze falls silent within a beat or two of the page drawing, while the person still looks at it.

To bisect, run it once per commit and read each verdict; to find the rule, one `--patch` per probe, each changing one thing.

Why not Playwright's WebKit: it shares no iOS-only layout code, so an iOS freeze passes there; and its `page.route` misses requests made through the service worker, so a replay there is answered by the real Deployment after the first load.

## Pages with text fields

A hand check, never run in CI, of the on-screen keyboard: whether it covers the caret or a page's Save. #159 shipped an Entry's page unchecked for it.

Run it whenever a page with text fields changes: an Entry's page (`apps/pwa/src/EntryPage.tsx`), a Task's or a Project's page (`apps/pwa/src/Inspector.tsx`), a composer (`apps/pwa/src/Composer.tsx`, the Conversation's in `apps/pwa/src/Conversation.tsx`, and `apps/pwa/src/grow-with-words.ts`), or the styles they are drawn with. Run it on an iPhone, in Safari and in Praxis added to the Home Screen and opened from there, since the two place the keyboard differently. Each case gets a pass or a fail.

| Case | Do | Passes when |
|---|---|---|
| The screen draws | Through the real-phone loop with the person's reads replayed, open Praxis, then tap Journal and Agent. | The loop counts Attention's rows within a second and never says `FROZEN`; each tab answers its tap. |
| An Entry's words | In the Journal, open an Entry's page by its Edit. Tap the end of its words and type new lines until they run past the fold, below where the keyboard begins. | The caret stays in view above the keyboard as each line is added. Save in the page's header is in reach: on screen, or brought back by scrolling up with the keyboard still open. The page does not zoom when the field is tapped. |
| Adding a Task | On the same page, tap the field that adds a Task and type a title. | The field is in view above the keyboard, the page does not zoom, and its Add is in reach. |
| A Task's title | In Attention, open a Task's page. Tap its title and type until it wraps past the fold. | The caret stays in view above the keyboard, and the page does not zoom. Back is in reach. |
| A composer's words | In the Journal, tap the composer and type new lines until it stops growing, then a few more. Do the same in the Agent's tab. | It grows a line at a time and stops before it covers the column above the keyboard; the newest Entry or Message stays just above it. The caret stays in view as each line is added, and Record or Send is in reach beside the words. Once recorded or sent, it folds back. |
| A Task's dates | On the same page, tap its Due Date. | The picker opens and the page does not zoom. Once a day is picked, the page shows it. |

Record each run below, replacing the last one: the date, the commit deployed, the iOS version, and each case's result. File a failure as a ticket.

## The last run

2026-11-27, Safari only: the Call bar's layout (its 12px over the column's edge, and its dot beside the title's first line), built from the checkout before it was committed, on 01f9e07.

| Case | Result |
|---|---|
| The screen draws | Pass, through the real-phone loop on the journeys' Worker with six Messages and the browser's voice fake served beside the heartbeat, counting the Conversation's Messages: each load drew all 25 within half a second, and none went `FROZEN` while shown. |
| An Entry's words, Adding a Task, A Task's title, A composer's words, A Task's dates | Not run: no page with text fields changed. |

Beyond the table, each passed: a Call started from the Agent's tab, the Messages scrolled under the bar were cut a step below its foot, never against it, the dot stood beside "On a Call in", Mute said "Muted" in the bar, and End Call ended it.
