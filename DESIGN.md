---
name: Praxis
description: Atelier, a calm, soft, exact look for a journal-centric task manager used many times a day.
colors:
  ground: "#ECEEF2"
  surface: "#FFFFFF"
  inset: "#F4F5F8"
  rule: "#D5D9E0"
  ink: "#1A1D23"
  muted: "#596070"
  warn: "#B42318"
  notice: "#FFF0CC"
  match: "#FFE58A"
  on-accent: "#FFFFFF"
  blue: "#2B55C4"
  blue-tint: "#E6ECFA"
  rust: "#A8480C"
  rust-tint: "#FAEBDD"
  teal: "#0E6B66"
  teal-tint: "#DFF1EF"
  plum: "#8A2F7E"
  plum-tint: "#F6E6F4"
  moss: "#4C6A14"
  moss-tint: "#EBF2DC"
  slate: "#4A5568"
  slate-tint: "#E9ECF1"
  ground-dark: "#0F1114"
  surface-dark: "#1B1E24"
  inset-dark: "#252931"
  rule-dark: "#3A3F4A"
  ink-dark: "#EEF0F4"
  muted-dark: "#A3AAB8"
  warn-dark: "#FF9388"
  notice-dark: "#3B300F"
  match-dark: "#5C4A0E"
  on-accent-dark: "#14161B"
  blue-dark: "#9DB6FF"
  blue-tint-dark: "#1E2740"
  rust-dark: "#F2A766"
  rust-tint-dark: "#3A2616"
  teal-dark: "#6FD0C6"
  teal-tint-dark: "#12302E"
  plum-dark: "#E3A1DA"
  plum-tint-dark: "#361C33"
  moss-dark: "#B5D075"
  moss-tint-dark: "#232E10"
  slate-dark: "#B4BECF"
  slate-tint-dark: "#262B35"
typography:
  screen-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: "32px"
    letterSpacing: "-0.02em"
  wordmark:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
    letterSpacing: "-0.02em"
  column-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "26px"
    letterSpacing: "-0.01em"
  words:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "26px"
  body-phone:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "23px"
  body:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  row-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: "22px"
  button:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: "22px"
  label:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "18px"
    letterSpacing: "0.01em"
  meta:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  caption:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.01em"
  code-block:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
rounded:
  radius-sm: "10px"
  radius-md: "14px"
  radius-lg: "20px"
  radius-pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  panel-gap: "14px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-pill}"
    padding: "0 20px"
    height: "40px"
  button-quiet:
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    padding: "0"
    height: "24px"
  button-send-at-rest:
    textColor: "{colors.blue}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-pill}"
    height: "40px"
  button-call:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-pill}"
    padding: "0 18px 0 14px"
    height: "40px"
  button-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.radius-pill}"
    size: "40px"
  context-switcher:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-pill}"
    padding: "0 12px 0 16px"
    height: "40px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.radius-pill}"
    padding: "0 10px"
    height: "32px"
  chip-set:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.radius-pill}"
    padding: "0 10px"
    height: "32px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.radius-lg}"
    padding: "20px"
  composer:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.ink}"
    typography: "{typography.body-phone}"
    rounded: "{rounded.radius-lg}"
    padding: "12px 12px 12px 16px"
  task-row:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    typography: "{typography.row-title}"
    rounded: "{rounded.radius-sm}"
    padding: "10px 12px"
  search-field:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    typography: "{typography.body-phone}"
    rounded: "{rounded.radius-pill}"
    padding: "0 6px 0 14px"
    height: "44px"
  mention:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.blue}"
    rounded: "{rounded.radius-sm}"
    padding: "2px 8px"
  reference:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius-sm}"
    padding: "2px 8px"
  held-change:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius-sm}"
    padding: "12px"
  message-from-person:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius-lg}"
    padding: "8px 12px"
  tab-bar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.radius-pill}"
    padding: "6px"
  tab-current:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.radius-pill}"
    height: "56px"
  jump-to-latest:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.radius-pill}"
    padding: "0 16px 0 12px"
    height: "38px"
---

# Design System: Praxis

The source of truth is code: `apps/pwa/src/design/tokens.ts` holds every colour, type style, space and radius, and the stylesheet is generated from it as custom properties (`--ground`, `--type-body`, `--space-3`, `--radius-md`). This file describes that system and the rules for using it. Where the two disagree, `tokens.ts` wins and this file is stale. The private Praxis design system artifact named in SPEC section 8.11 is what `tokens.ts` was written from.

The frontmatter lists each colour twice: the bare name is its light value, and `-dark` is the same token when the Device prefers dark. There is no theme switch, and no `-dark` token is ever used by name in code: the one custom property changes with `prefers-color-scheme`. Components in the frontmatter use Blue to stand for whichever accent the current Context has.

## Overview

**Creative North Star: "The Atelier"**

A workroom kept for one person. The walls are a cool tinted ground. The work sits on soft white panels with generous corners, and every tool in reach is round. Nothing is ornamental, because the person's own words are what the room is for. The Journal's words are set one step larger than the interface around them, and Markdown in them changes weight, indentation and face, never size or colour.

The mood is **calm, soft, exact**. Soft in form: pills, circles, 20px panel corners, tone instead of shadow. Exact in meaning: every state is said in words, every icon that stands alone has a name, and colour never carries a meaning by itself. Praxis is reached many times a day, so it is quiet. Things appear where they are needed, at once, and the only motion is a page sliding in as the person goes one level deeper, and a press fading back as it lifts.

The one expressive element is the **Context accent**. Each Context has one of six, and it marks where the person is about to write or decide: the Context switcher, both composers, a Held Change and a Mention. Everything else is neutral, so the accent always answers one question: which Context am I in?

**Key Characteristics:**
- Soft panels on a tinted ground: three peers side by side on a desktop, three bottom tabs on a phone.
- One family, Figtree, with the Device's monospace for code only.
- Round controls: every button, switcher, chip, badge, search field and tab bar is a pill, and a Task's control is a circle.
- Flat by rule: depth comes from tone and hairlines, never from shadows.
- One accent per Context, from a fixed six, and nothing else takes it.
- Light and dark follow the Device, WCAG 2.2 AA in both.

## Colors

A cool, low-chroma neutral scale with six accents. Each accent is a deep shade for text and solids in light and a pale shade in dark, paired with a tint.

### Primary
The primary is **the current Context's accent**, one of six, set by wrapping a region in `.accent-<name>`, which defines `--accent` and `--accent-tint`:
- **Blue** (`blue`, tint `blue-tint`)
- **Rust** (`rust`, tint `rust-tint`)
- **Teal** (`teal`, tint `teal-tint`)
- **Plum** (`plum`, tint `plum-tint`)
- **Moss** (`moss`, tint `moss-tint`)
- **Slate** (`slate`, tint `slate-tint`)

An accent is used three ways. Solid, under `on-accent`, for the one primary button in a place, the Context switcher and badges. As text on `surface` or on its own tint, for a composer's label and a Mention. And as a tint ground, for a composer, a Held Change and a Mention.

### Neutral
- **Ground** (`ground`): the page behind the panels, the top bar, and the tone a row of Attention steps to while hovered.
- **Surface** (`surface`): a panel (Attention, the Journal, the Conversation), a card on the phone, the tab bar, a menu or picker.
- **Inset** (`inset`): what sits inside a panel: a Task row, the search field, a Reference, the current tab, the person's own Message, code. It always sits on `surface`.
- **Rule** (`rule`): a hairline border or divider, and the edge of a chip, a menu or a picker. When the Device asks for more contrast, it takes `muted`'s value, so every edge stands out at 3:1 or more.
- **Ink** (`ink`): text on every neutral, on `notice` and on any tint. Also the app icon's tile, the focus ring, a chip that is set, and the Jump to latest pill.
- **Muted** (`muted`): secondary text (times, meta, notes, an inactive tab, a field's placeholder at full opacity on `surface` or `inset`) and the border of a Task's empty control.

### Signal
- **Warn** (`warn`): lateness (Overdue), and a refusal the screen shows in words (`.problem`, such as a Context that could not be made), as text on `surface` or `inset`, or on a hovered row's `ground` tone, always with words. Its one solid use is the End Call button, under `on-accent`. Nothing else takes it: a Project with no open Task is bold `ink`, and Delete on a record's page is `ink`, as Drop is.
- **Notice** (`notice`): the ground of a standing Notice's card, with `ink` on it, its link included. Nothing else takes it.
- **Match** (`match`): the mark on what a search matched, in an excerpt or a title, with `ink` at 600 on it. Nothing else takes it.
- **On-accent** (`on-accent`): text and icons on a solid accent, and the icon on End Call's solid `warn`.

### Named Rules
**The One Accent Rule.** Only the current Context's accent appears on the screen, and only where the person is about to write or decide: the switcher, both composers, the primary button, a Held Change, a Mention, badges. A secondary action, a link, a heading or a selected state never takes it.

**The Words Not Colour Rule.** No state is shown by colour alone. Overdue is `warn` *and* the words "Overdue since …". A Context's swatch always sits beside its name. Red means late, or a refusal the person must read, and nothing else is red.

**The Pairing Rule.** Every text-on-ground pairing is held to 4.5:1 in both themes by `apps/pwa/test/tokens.test.ts`. A new pairing is added to that test before it ships.

## Typography

**Body Font:** Figtree Variable (with system-ui, sans-serif), shipped with the app.
**Mono Font:** the Device's own (ui-monospace, SF Mono, Menlo, Consolas), for code only.

**Character:** one geometric-humanist family carries the whole interface, with its weights doing the work a second family would: 700 for titles, buttons and labels, 500–600 for row titles and emphasis, 400 for reading.

### Hierarchy
- **Screen title** (700, 26px/32px, −0.02em): a screen of its own, such as Settings.
- **Wordmark** (700, 22px/28px, −0.02em): "Praxis" beside the mark in the top bar, from 720px up.
- **Column title** (700, 20px/26px, −0.01em): the head of each peer.
- **Words** (400, 17px/26px): an Entry's words, the person's own, one step larger than the interface. Also the size they are edited at, on an Entry's page and in its editor.
- **Body on a phone** (400, 16px/23px): the base size below 720px, and the composers' text.
- **Body** (400, 15px/22px): the interface's base on a desktop, and a Message's words.
- **Row title** (500, 15px/22px): a Task's or a search hit's title.
- **Button** (700, 15px/22px): every button's word.
- **Label** (700, 13px/18px, +0.01em): a composer's label, a group heading in Settings, a chip, every badge but a tab's.
- **Meta** (400, 13px/18px): a time, an author, a Task's mark ("Due today" at 700 in `muted`, "Overdue" at 700 in `warn`, a Project's "Needs a next Task" at 700 in `ink`).
- **Caption** (600, 12px/16px, +0.01em): a day's label, a tab's name, a tab's badge.
- **Code block** (400, 14px/22px, mono): code in an Entry's words.

### Named Rules
**The Words Lead Rule.** An Entry's words are always the largest running text on the screen (17px). Markdown inside them changes weight, indentation and face, never size, and never takes the accent.

**The Tracking Rule.** Tracking follows size: the titles and the wordmark are drawn tighter, the reading sizes at none, and Label and Caption opened up 0.01em, since Figtree has none of a system face's own tracking for small sizes. A style's tracking is its `--tracking-<name>`, set beside its `font`, which cannot carry it.

**The One Family Rule.** Figtree is the only typeface. A second family never comes in for headings or emphasis. Monospace is for code, never for numbers or labels. Tabular figures serve the time on a Call.

## Layout

The main screen is three peers on the ground, none hosting the others (SPEC section 8.1). Its widths are fixed:

- **Desktop (1200px and up):** three panels in a row, `panel-gap` (14px) between them and around the window: Attention 350px, the Journal flexible, the Conversation 420px.
- **In between (720px to 1199px):** the Journal and the Conversation (up to 360px, never wider than the Journal) side by side. Attention is a 350px panel opened over them from the top bar's button, bordered in `rule`, with a Close icon button in its header. While it is open the two under it are inert, and a press on them closes it.
- **Phone (below 720px):** one peer at a time, edge to edge on the ground, with three tabs in a pill at the bottom. The side gutter is `space-4` (16px), and the base text is 16px.

A panel's header, content and composer share one inset, `space-5` (20px), so their left edges line up. While a column's content is scrolled away from its top, the header has an edge: a `rule` hairline the width of the column where what scrolls is cut, under the header, or under what stands beneath it, such as the search's chips. At the top it has none. It is a border, never a shadow, a blur or a gradient. Inside a panel, sections are `space-4` apart, Task rows `space-1`, and controls `space-2` from their neighbours. Settings is a screen of its own, its column of groups no wider than 720px. Pages pushed inside Attention (a Task's or Project's page) cover the whole column, header and all.

The Journal and the Conversation keep time order, oldest first, and open at their newest, just above the composer. A day is a `caption` label in `muted` with a `rule` hairline running to the column's edge. With nothing in it, each says so in one line in `muted`, centred in the column.

**The Newest Beside the Composer Rule.** Where the person types is the bottom of the column, and the newest is just above it. Never invert a column or put a composer at the top.

**The 44px Rule.** On a phone every touch target is at least 44px: buttons, icon buttons, the switcher, a Task's label, a Task's dates, a standing Notice's link (its target grown round its text, which stays where it is). A desktop's controls are 40px, or 36px for a row's own icon button.

## Elevation & Depth

Praxis is flat, by rule. Depth is told by tone: the `ground` behind, a `surface` panel on it, an `inset` row inside the panel. A `rule` hairline gives an edge where tone alone is not enough: a menu, a picker, the context list, Attention when it opens over the Journal. `box-shadow` appears only as a ring, never as a cast shadow: the `surface` ring that lifts the Call's dot off its tint, and an inset 1px or 2px ring that draws a field's edge on an Entry's page.

**The Flat Rule.** No drop shadows, no blur, no glow, no gradients for depth. If something must stand above what is under it, it takes `surface` and a `rule` hairline.

## Shapes

Round throughout, in four radii:
- **Small** (10px, `radius-sm`): a Task row, a Mention or Reference, a box inside a card, a Held Change, code in an Entry's words.
- **Medium** (14px, `radius-md`): a card, a menu, a picker, an Entry hovered on a desktop, an Entry's card on a phone, an Unsent Entry's box.
- **Large** (20px, `radius-lg`): a panel, a composer, the person's own Message, a Call's bar.
- **Pill** (999px, `radius-pill`): every button, the Context switcher, badges, chips, the search field, the tab bar and its tabs. A Task's control, a swatch and the Call's dot are full circles.

The app icon's tile is the one exception: 32px with a 9px corner, in proportion to the icon.

**The Round Controls Rule.** Anything pressable is a pill or a circle. A square button, or a checkbox drawn as a square, never appears. A switch is a 46×28 pill, never a checkbox.

## Components

The controls are **soft and certain**: round and gentle in form, with one solid accent for the one primary act in a place, and everything else quiet.

### Buttons
- **Shape:** a pill (999px), 40px high on a desktop and 44px on a phone, with its icon and word `space-2` apart.
- **Primary:** the solid accent with `on-accent` text, 20px each side. The Journal's **Record** is a pill with the check icon and its word. The Conversation's **Send** is a 40px round button (44px on a phone) with the arrow-up icon.
- **A send with nothing to send:** while its composer is empty, Record or Send is the accent's icon (and Record's word) on the composer's tint, at full opacity with no fill of its own, and is still disabled, so it is announced as unavailable. It is at rest, not broken, so it is never washed out. With something to send it turns the solid accent.
- **Call:** a `surface` pill with a `rule` edge, the Lucide `phone` icon and the word "Call" in `ink` at 700, at the button's height, the word kept on a phone. It is the Conversation's rarest act, so it never takes the accent from its Send.
- **Quiet:** words in `ink` at 600, underlined 3px below, with no fill. It is every secondary action, because nothing but the primary takes the accent.
- **Icon button:** a 40px circle (44px on a phone), `surface` with a `muted` icon. Used alone only on a well-known action (Edit, Follow up, Dates, Send, Search, Close, More), with an accessible name and a tooltip.
- **Jump to latest:** an `ink` pill with `surface` text, the arrow-down icon and a count, centred above the composer.
- **End Call:** a 60px circle of solid `warn` under `on-accent`, the phone icon turned 135°, its word underneath. Mute beside it is the same circle on `inset` with the Lucide `mic` icon; muted, it turns `ink` under `surface` with `mic-off`, and keeps its word, since the Call bar says "Muted".
- **Disabled:** 50% opacity, for every control but a composer's send with nothing to send. A Call that cannot start stays focusable and says why in `meta` under it, since a touch screen has no tooltip.
- **Pressed:** a button, a link, a disclosure or a picker's choice that can be pressed is dimmed to 70% the moment the press lands, and back over 160ms on `ease-out` once it lifts, as a native control answers a finger; with reduced motion, back at once. A link that is a row, such as a section of Settings, sits on `inset` while pressed instead, as it does when hovered. The browser's grey tap box is never drawn.
- **Focus:** a 2px `ink` outline, 2px off, on everything.

### Chips
- **Style:** a 32px pill (44px on a phone), `surface` with a `rule` border, `label` type at 600 in `ink`, with its end (a chevron or ×) in `muted`. A chip is one line: what it holds is cut with an ellipsis past 240px, or on a phone past 60% of its row, and its icon and its end never shrink.
- **State:** once set, it turns solid `ink` with `surface` text. It never takes the accent. Its picker is a `surface` box with `radius-md` and a `rule` border, whose choices sit on `inset` when hovered, focused or highlighted. It opens inside its column, from the chip's end where it would run past the column's, and is never wider than the column.

### Cards / Containers
- **Panel:** `surface` on `ground`, `radius-lg`, with a 20px inset and a `column-title` head.
- **Entry:** from 720px up, Entries are parted by `rule` hairlines with no box, their ends square. The one hovered or focused sits on `inset` with `radius-md`, and its Task rows turn `surface` so they stay one step off it. On a phone, each Entry is a `surface` card with `radius-md` on `ground`, `space-2` apart. Its time and its marks are centred on their line, each line of them where they wrap, so on a phone the time lines up with the 44px button at the line's end. An Unsent Entry is boxed by a dashed `rule` hairline with `radius-md`, in place of the hairlines that part the others, and its time is followed by Unsent in `ink` at 600.
- **Held Change:** the accent's tint with `radius-sm` and 12px padding: a bold title, the words as they would be, and its actions in a row.
- **Standing Notice:** a card on `notice` with `radius-md`, in Attention above its sections. The Lucide `info` icon sits beside a bold title of a few words ("Spend cap reached", "Brief not run"), set at the size of the words under it. The words follow in `ink`, then the underlined link to the section of Settings that deals with it, where there is one. The card is a status named by its title.
- **A Notice in the Conversation:** a `rule`-bordered box with `radius-lg`, its words in `muted`. One sits under the person's Message whose Run failed, outside its bubble and aligned to its right edge, with Try again as a quiet button and the way to save the Run's transcript after it in `meta`. Others stand in the Conversation's foot: no key, a model with no price, a Conversation that cannot be opened, no network, the cap reached (with its link), and a Call ended.

### Inputs / Fields
- **Composer:** the accent's tint, a 1.5px accent border, `radius-lg`. Its `label` sits in the accent above the words. At rest it is one line, its label where the words will go and its send at its end. A label too long for its line is cut short with an ellipsis; the send never is, and Record keeps its icon and its word at every width. Focused, it opens to two lines at once, with no animation, and takes a 2px accent outline 2px off. As the words run past two lines it grows with them, a line at a time and with no animation, up to 40% of its column's height, and then scrolls within itself. On a phone that is 40% of the column as shown, above the on-screen keyboard, so the composer never covers the column.
- **Search field:** a 44px `inset` pill with a `muted` search icon. Focused, its 1.5px border turns `ink`, and the 2px `ink` outline is drawn 2px off round the whole field, as its input draws none. The browser's clear button is hidden for the screen's own. While a newer search is out, what is shown for the one before is dimmed and busy, its words `muted` and what matched unmarked, never by an opacity that would take them under 4.5:1, and after 300ms with no answer the status says "Searching…" in `meta` `muted`.
- **Date field:** a `surface` field with a `rule` border and `radius-sm`, in a Task's row. With no day in it, its placeholder ("dd/mm/yyyy", or the locale's) is `muted` until it is typed in.
- **Switch:** a 46×28 pill, `muted` when off and accent when on, its knob `surface`. The knob slides in 150ms on `ease-out` only when motion is allowed.

### Navigation
- **Top bar:** on `ground`, 52px high (60px on a phone): the mark and wordmark, then the Context switcher, then (between 720px and 1199px) the Attention button with its count, and Settings as an icon button at the far end. On a phone it shows the mark alone, still named "Praxis", and the switcher takes the width, its name cut with an ellipsis; Settings never shrinks from its 44px circle. Search belongs to the Journal: a field in its header, or a button on a phone.
- **Attention button:** a `surface` pill in `ink`. While Attention is open it sits on `inset` in `ink` at 700, as the current phone tab does, and says so with `aria-expanded` too.
- **Context switcher:** a pill of the current Context's solid accent with its name at 600. It opens a `surface` list where each Context is its swatch beside its name, and the current one sits on `inset` at 600.
- **Phone tabs:** a `surface` pill below the content, 16px in from each side, holding Attention (inbox), the Journal (book-open) and the Agent (message-circle). Each tab is 56px high with its icon over its `caption` name, and its count or unread dot at the icon's shoulder. The current tab sits on `inset` in `ink` at 700. The others are `muted`.
- **Settings:** on a desktop, a `surface` sidebar of sections in two groups, the Context's under its accent dot and the Deployment's, with the section shown on its tint in accent. On a phone, the same groups as rows with an icon, a `muted` value and a chevron.

### Task row
The most repeated object in Praxis. An `inset` row with `radius-sm`, 10px by 12px: a 20px circle control with a 2px `muted` border (filled with an `ink` dot once Finished), the title in `row-title`, then its marks in `meta`, then the calendar icon button at the row's end, never the word. Each state that holds is its own mark in words. Due today is bold in `muted`, Overdue bold in `warn`, and a closed Task's title turns `muted`. In Attention's one-line rows on a phone the control is a 44px target, its 20px circle drawn at the centre, and the row's open button begins where it ends.

In Attention a row's mark takes at most 40% of the row, and gives way to the title, cut with an ellipsis before the title's two lines are; Overdue and Due today are never cut. A row that opens a page takes one tone step while the pointer hovers where it opens, `inset` to `ground`'s tone, and its chevron turns `ink`. On a phone, where Attention sits on the ground itself, its rows are `surface`, as `inset` always sits on `surface`, and step to `inset` when hovered.

### Links in an Entry
A Mention is the accent on its tint, a Reference is `ink` on `inset`, both at 600 with `radius-sm`. A link to a record in the Trash is `muted` on `inset` at 400, and says so in words.

### Conversation
The person's Message sits on the right, no wider than 85%, on `inset` with `radius-lg`. The Agent's words sit on the panel with no box, under a `meta` line naming who spoke. A Call going replaces the header with a bar on the accent's tint, at the column's 20px inset: an accent dot, "On a Call in" the Context in `button` type at the accent, and a `meta` line of the time in tabular figures and what holds ("Muted", "Agent working"). The header's title stays in the outline for a screen reader. Between a Message sent and its answer's first words, "Agent working" sits where the answer will appear, in `meta` and `muted`, still. A Run's calls fold under its Message as a `meta` disclosure with a `muted` chevron, named by the tools it used; inside, its tools and changes are plain indented lines with no bullets, and a change's link is drawn as an Entry's link is, in `ink`.

On a phone, while a Call goes on, the Agent tab carries the Call's mark: the Lucide `phone` at 12px in the accent, on a `surface` ring, at the icon's other shoulder from the unread dot, so the two are never taken for each other. In Settings the top bar carries the Call bar's dot beside "On a Call", a quiet button back to the Conversation; on a phone, short of room beside the switcher, it takes a line of its own under it.

### Motion
The one motion is a page going one level deeper, beside a press fading back as it lifts (Pressed, under Buttons), which is feedback on the person's own touch. A Task's, Project's or Entry's page slides in 24px from the side, fading in over 220ms on `ease-out`. Motion takes one curve, the `ease-out` token, `cubic-bezier(0.23, 1, 0.32, 1)`: fast at once, settling softly. A page gone back to is simply there. With reduced motion it is a 160ms fade, ease-out. Composers, menus, pickers and tabs appear at once.

## Do's and Don'ts

### Do:
- **Do** take every colour from `tokens.ts` through its custom property (`var(--inset)`): the stylesheet holds no raw hex or rgb. Type, spaces and radii mostly come from their tokens too (`var(--type-meta)`, `var(--space-3)`, `var(--radius-md)`), with a few one-off px values.
- **Do** wrap anything drawn in a Context's colours in `.accent-<name>` and use `--accent` and `--accent-tint`, never a named accent.
- **Do** put an icon beside its label on the tabs, the sections of Settings, Attention's section headings (Loose's is `list`, not the circle a Task's control is drawn as), the groups of what a search finds and the primary buttons. Interface icons are Lucide, stroked with round caps, at the text colour.
- **Do** say every state in words, beside any colour it takes.
- **Do** keep text fields at 16px or larger at any width wherever a finger can reach them, a touch screen beside a trackpad too, so the page does not zoom when one is tapped.
- **Do** put every `:hover` look behind `(hover: hover) and (pointer: fine)`, so a tap on a touch screen leaves nothing hovered.
- **Do** let text the person typed take its own direction (`dir="auto"`), so a sentence in Arabic reads right to left and ends at its left: in search, an excerpt, a hit's title or name, and a name in a chip or a picker. The screen's own words keep the screen's direction.

### Don't:
- **Don't** use the accent on anything but where the person is about to write or decide (The One Accent Rule). A secondary button is quiet, in `ink`.
- **Don't** add a shadow, blur, glow or gradient for depth (The Flat Rule).
- **Don't** draw a square control or a checkbox. Controls are pills and circles.
- **Don't** bring in a second typeface, an icon set other than Lucide, or any asset fetched from elsewhere.
- **Don't** give the app icon or the mark a Context's accent. It stands for the whole Deployment, white on an `ink` tile.
- **Don't** animate what is reached many times a day: a composer opening, a menu, a tab change.
- **Don't** use `warn` for anything but lateness, a refusal shown in words, or End Call, and `match` for anything but a search's mark. Delete is `ink`, as Drop is.
