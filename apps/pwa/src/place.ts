import { createSignal } from "solid-js";

// Where the screen is, as its address says (section 8.6): `/` is the main screen, `/settings` is
// Settings at its first section, and `/settings/<section>` one section. The new-entry address and a
// Notification's are read once by the screen and put back to `/` before this reads the address.

/** Each section of Settings, by its name in the address, in the order Settings lists them. */
export const SECTIONS = [
  "general",
  "brief-and-review",
  "standing",
  "changes",
  "trash",
  "conversation-and-search",
  "contexts",
  "connections",
  "devices",
  "spend",
  "backups",
] as const;

export type Section = (typeof SECTIONS)[number];

/**
 * Where the screen is. In Settings, `section` is the one the address names, or null at `/settings`
 * itself, which a desktop shows as General and a phone as the list of sections.
 */
export type Place = { settings: false } | { settings: true; section: Section | null };

const MAIN: Place = { settings: false };
const SETTINGS = "/settings";

/** The place an address names. An unknown section shows General. */
function placeAt(path: string): Place {
  if (path === SETTINGS || path === `${SETTINGS}/`) return { settings: true, section: null };
  if (!path.startsWith(`${SETTINGS}/`)) return MAIN;
  const named = path.slice(SETTINGS.length + 1);
  return { settings: true, section: SECTIONS.find((each) => each === named) ?? "general" };
}

/** A section's address. */
export function sectionAddress(section: Section | null): string {
  return section === null ? SETTINGS : `${SETTINGS}/${section}`;
}

const [place, setPlace] = createSignal<Place>(MAIN);

export { place };

/**
 * How many entries of the browser's history Settings has pushed since the main screen, kept in each
 * entry's state, so leaving Settings goes back to the main screen's own entry, as it was left.
 */
type Pushed = { settingsDepth: number };

function depth(): number {
  const state = history.state as Partial<Pushed> | null;
  return typeof state?.settingsDepth === "number" ? state.settingsDepth : 0;
}

/**
 * Follow the address: read it now and as the browser's back and forward move it. Settings opened
 * at its own address, by a link or a reload, has the main screen put behind it, so Back from it
 * reaches the main screen. Returns a way to stop following.
 */
export function followAddress(): () => void {
  const opened = placeAt(location.pathname);
  if (opened.settings && depth() === 0) {
    const address = location.pathname;
    history.replaceState(null, "", "/");
    history.pushState({ settingsDepth: 1 } satisfies Pushed, "", address);
  }
  setPlace(opened);
  const moved = () => setPlace(placeAt(location.pathname));
  window.addEventListener("popstate", moved);
  return () => window.removeEventListener("popstate", moved);
}

/** Show Settings at a section, or at its first: a new entry in the browser's history. */
export function openSettings(section: Section | null = null) {
  const address = sectionAddress(section);
  if (address === location.pathname) return;
  const pushed: Pushed = { settingsDepth: depth() + 1 };
  history.pushState(pushed, "", address);
  setPlace(placeAt(address));
}

/**
 * Show the main screen again, as it was left, and take the browser back to its entry, so forward
 * reaches Settings again as it would after Back.
 */
export function leaveSettings() {
  if (!place().settings) return;
  const back = depth();
  setPlace(MAIN);
  if (back > 0) history.go(-back);
  else history.replaceState(null, "", "/");
}

/** Follow a link as the screen does, unless the person asked the browser for a tab of its own. */
export function followed(event: MouseEvent, go: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  go();
}
