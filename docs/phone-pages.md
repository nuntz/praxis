# Pages with text fields, on a phone

A hand check, never run in CI, of what only a real phone shows: its on-screen keyboard. Playwright's phone emulation has none, so whether the keyboard covers the caret or a page's Save cannot be checked in a journey (SPEC section 13), and #159 shipped an Entry's page unchecked for it.

Run it whenever a page with text fields changes: an Entry's page (`apps/pwa/src/EntryPage.tsx`), a Task's or a Project's page (`apps/pwa/src/Inspector.tsx`), or the styles they are drawn with. Run it on an iPhone, in Safari and in Praxis added to the Home Screen and opened from there, since the two place the keyboard differently. Each case gets a pass or a fail.

| Case | Do | Passes when |
|---|---|---|
| An Entry's words | In the Journal, open an Entry's page by its Edit. Tap the end of its words and type new lines until they run past the fold, below where the keyboard begins. | The caret stays in view above the keyboard as each line is added. Save in the page's header is in reach: on screen, or brought back by scrolling up with the keyboard still open. The page does not zoom when the field is tapped. |
| Adding a Task | On the same page, tap the field that adds a Task and type a title. | The field is in view above the keyboard, the page does not zoom, and its Add is in reach. |
| A Task's title | In Attention, open a Task's page. Tap its title and type until it wraps past the fold. | The caret stays in view above the keyboard, and the page does not zoom. Back is in reach. |
| A Task's dates | On the same page, tap its Due Date. | The picker opens and the page does not zoom. Once a day is picked, the page shows it. |

Record each run below, replacing the last one: the date, the commit deployed, the iOS version, and each case's result. File a failure as a ticket.

## The last run

None yet. #159 shipped an Entry's page with this check not run, as its pull request says.
