# Product

<!-- impeccable:product-schema 1 -->

This file holds the product truth design work needs. It does not replace [`SPEC.md`](SPEC.md), which wins on what is built, [`GLOSSARY.md`](GLOSSARY.md), which wins on what a word means, or [`docs/adr/`](docs/adr/), which wins on why. Where this file and those differ, they win and this file is stale.

## Platform

web

An installable PWA (SolidJS) served by one Cloudflare Worker, which also serves MCP under `/mcp`. It runs in desktop browsers and on phones, including Praxis added to an iPhone's Home Screen. It has no native app.

## Users

One person: the person, the one human the Deployment belongs to, who built it for themselves. No design decision is made for anyone else, even though others may read or fork the repository. There are no tenants, no sharing and no roles (SPEC section 2, principle 8).

The person uses it on phone and desktop about equally, so neither width is the primary one:

- **Desktop**: the three columns side by side, Attention, the Journal and the Conversation, for longer sessions of writing, reviewing and working with the Agent.
- **Phone**: three bottom tabs, opening on Attention, used in quick moments through the day to capture an Entry, check what is open, or talk to the Agent, sometimes by voice on a Call.

The **Persons** in Praxis are records of people the person deals with. They never use Praxis and have no access to it.

## Product Purpose

Praxis is a self-hosted, journal-centric personal task manager. The person writes in a Journal. Tasks, Projects and Persons are made from what is written and stay tied to it. An Agent works on the same Journal, and outside agents reach it over MCP.

Success means the person trusts the Journal as the one place their work and commitments live, can see at a glance what is open for them to act on, and can hand work to the Agent without checking up on it, because anything it does can be put back.

## Positioning

- **The Journal is the only truth** (ADR 0001). Anything worth keeping is an Entry or derives from one. A Task has no body, and a Project has no description: what there is to say about them is said in Entries.
- **Agentic-first, with one tool seam** (ADR 0007). The screen, the Agent and outside Connections call the same tools, and every change reports its Effects. Every capability is a tool before it is a screen.
- **The person's words are kept as written.** The Agent records the person's words verbatim, never paraphrased. The server never reads words to find Tasks or links. Only a pick makes a link.
- **State is derived, never set.** Waiting, Delegated, Deferred and Overdue follow from what happened. Attention is worked out by rule, with no judgment by the Agent and no key needed.
- **The Agent acts at once, and safety is being able to put things back** (ADR 0005). Versions and the Trash take the place of confirmation prompts. Only a change to the person's own words is held, as a Held Change.
- **It runs on the person's own Cloudflare account**, and the model is reached with the person's own key (ADR 0017). No words leave except to the providers the person gave a key for (ADR 0010).

## Operating Context

- **Contexts** split the person's life into separate worlds, and nothing crosses between them. Each has an accent colour, a time zone and one Conversation, and the screen always shows one current Context.
- **Daily rhythm**: a Brief at a set time and a weekly Review, the only things that notify, with no words in the Notification (ADR 0013).
- **Ways in**: the Journal's composer, the Conversation, a Call (voice), the share sheet and a home-screen shortcut on Chromium, and outside agents (such as Claude through the Praxis connector) over MCP.
- **Offline** is two unsent writes and an Offline Copy to read, not a replica (ADR 0020).
- **Sign-in** is Cloudflare Access; the address carries the Context (ADR 0009).

## Capabilities and Constraints

The full set is in SPEC.md. Constraints that bear on design:

- The main screen is three peers, none hosting the others, and each composer has one send (ADR 0022, SPEC section 8.1). Where the person types decides what happens.
- The layout at each width in SPEC section 8.1 is fixed.
- Light and dark follow the Device, with no switch.
- The interface is in English, with no translation layer. An Entry can be in any language. Dates and numbers follow the Device's locale.
- An Entry's words are Markdown only on the screen, and an image loads by itself only when the person wrote it by hand (ADR 0025).
- No outside assets but Lucide icons and the Figtree typeface, both shipped with the app; it fetches nothing from elsewhere (SPEC section 8.11).
- Out of scope: more than one user, attachments, times of day on a Due Date, reminders, and the other items in SPEC section 14.

## Brand Commitments

- **Name**: Praxis. **Mark**: the Lucide hammer, white on a dark neutral tile, never in a Context's accent (SPEC section 8.11).
- **Visual direction is already decided and binding**: Atelier, recorded in SPEC section 8.11 and in the private Praxis design system artifact, whose tokens are in code at `apps/pwa/src/design/tokens.ts`. This file does not restate it; design work starts from those.
- **Terminology** is the Glossary's, capitalised in prose and on the screen as there: Entry, Task, Project, Person, Context, Attention, Journal, Conversation, Agent, Brief, Review, Held Change, Call, Trash, and the rest. A screen never introduces a synonym.
- **Voice**: plain, short words, saying what is so rather than selling it. The design system holds the interface voice.

## Evidence on Hand

- The private design canvases named in SPEC section 8.11: the design directions, the UI polish canvas and the search directions.
- The person's own Journal in production is real content, but its words are private (ADR 0010) and are never used in design work, screenshots or fixtures.
- There are no customers, testimonials, pricing or marketing pages, and none should be invented. Praxis has no landing page.

## Product Principles

1. **Where the person types decides what happens.** One send per composer, no mode to guess, and the newest beside the composer.
2. **Show what is so, in words.** Every state carries its reason, and nothing is ranked or conveyed by colour alone.
3. **Undo over asking.** Act at once and make it easy to put back, instead of confirming first.
4. **The person always knows which Context they are in** before they write.
5. **Calm for daily use.** It is reached many times a day, so nothing animates or interrupts without a reason. Only a Brief or a Review notifies.

## Accessibility & Inclusion

- WCAG 2.2 AA, in light and in dark, with every token pairing held to contrast in `tokens.test.ts`. Everything is reachable by keyboard (SPEC section 8.11).
- An icon stands alone only on a well-known action, and then has an accessible name and a tooltip.
- Pages with text fields are checked by hand on a real iPhone, in Safari and from the Home Screen ([`docs/phone-pages.md`](docs/phone-pages.md)), since no emulator has an on-screen keyboard.
