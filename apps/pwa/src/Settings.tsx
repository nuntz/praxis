import {
  type ContextListing,
  type Settings as ContextSettings,
  type Weekday,
  weekdays,
} from "@praxis/domain";
import Archive from "lucide-solid/icons/archive";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Gauge from "lucide-solid/icons/gauge";
import Globe from "lucide-solid/icons/globe";
import Layers from "lucide-solid/icons/layers";
import MessageCircle from "lucide-solid/icons/message-circle";
import Pin from "lucide-solid/icons/pin";
import Plug from "lucide-solid/icons/plug";
import History from "lucide-solid/icons/rotate-ccw-clock";
import Smartphone from "lucide-solid/icons/smartphone";
import Sunrise from "lucide-solid/icons/sunrise";
import Trash2 from "lucide-solid/icons/trash";
import { createSignal, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { BackupSettings } from "./Backups.tsx";
import { Changes } from "./Changes.tsx";
import { Connections } from "./Connections.tsx";
import { BriefAndReview, ConversationAndSearch, GeneralSettings } from "./ContextSettings.tsx";
import { Contexts } from "./Contexts.tsx";
import { Devices } from "./Devices.tsx";
import { ExportSettings } from "./Export.tsx";
import { money } from "./Notices.tsx";
import {
  followed,
  leaveSettings,
  openSettings,
  SECTIONS,
  type Section,
  sectionAddress,
} from "./place.ts";
import { SpendSettings, spend } from "./Spend.tsx";
import { Standing } from "./Standing.tsx";
import { Trash } from "./Trash.tsx";

type Icon = typeof Globe;

/** Each section's name and icon, and whether it is the current Context's or the Deployment's. */
const NAMED: Record<Section, { name: string; icon: Icon; ofContext: boolean }> = {
  general: { name: "General", icon: Globe, ofContext: true },
  "brief-and-review": { name: "Brief and Review", icon: Sunrise, ofContext: true },
  standing: { name: "Standing Entries", icon: Pin, ofContext: true },
  changes: { name: "Changes", icon: History, ofContext: true },
  trash: { name: "Trash", icon: Trash2, ofContext: true },
  "conversation-and-search": {
    name: "Conversation and search",
    icon: MessageCircle,
    ofContext: true,
  },
  contexts: { name: "Contexts", icon: Layers, ofContext: false },
  connections: { name: "Connections", icon: Plug, ofContext: false },
  devices: { name: "Devices", icon: Smartphone, ofContext: false },
  spend: { name: "Spend", icon: Gauge, ofContext: false },
  backups: { name: "Backups and Export", icon: Archive, ofContext: false },
};

// A phone shows the list of sections and a section as screens of their own; wider, the list is
// beside the section shown. The width is the stylesheet's, of section 8.1.
const phoneWidth = window.matchMedia("(width < 720px)");
const [onPhone, setOnPhone] = createSignal(phoneWidth.matches);
phoneWidth.addEventListener("change", (event) => setOnPhone(event.matches));

/**
 * Settings' end of the top bar: the way back to the main screen, and on a phone in a section, the
 * way back to the list of sections. Escape returns to the main screen too.
 */
export function SettingsBar(props: { section: Section | null; contextName: string }) {
  return (
    <>
      <Show
        when={onPhone()}
        fallback={
          <a href="/" class="settings-back" onClick={(event) => followed(event, leaveSettings)}>
            <ArrowLeft size={18} aria-hidden="true" />
            Back to {props.contextName}
          </a>
        }
      >
        <Show
          when={props.section !== null}
          fallback={
            <a
              href="/"
              class="settings-back settings-done"
              onClick={(event) => followed(event, leaveSettings)}
            >
              Done
            </a>
          }
        >
          <a
            href={sectionAddress(null)}
            class="settings-back"
            onClick={(event) => followed(event, () => openSettings(null))}
          >
            <ChevronLeft size={20} aria-hidden="true" />
            Settings
          </a>
        </Show>
      </Show>
      <h1
        class="settings-title"
        classList={{ "visually-hidden": onPhone() && props.section !== null }}
      >
        Settings
      </h1>
    </>
  );
}

/**
 * Settings, a screen of its own (section 8.6): its sections in two groups, the current Context's
 * and the Deployment's, listed beside the one shown on a desktop, where it opens on General, and
 * as a list of their own on a phone, each opening from it. Each section is one of the screen's
 * panels; with the Context's settings not read, those that need them say they need the network,
 * and the Standing Entries are the Offline Copy's.
 */
export function SettingsScreen(props: {
  section: Section | null;
  contextName: string;
  settings: ContextSettings | null;
  onSettingsChanged: (settings: ContextSettings) => void;
  /** The zone the Offline Copy's Standing Entries are shown in, with no settings read and no network. */
  offlineZone: string | null;
  contexts: ContextListing[];
  onContextChanged: (changed: ContextListing) => void;
  onContextMade: (made: ContextListing) => void;
  onContextDeleted: (id: string) => void;
}) {
  // A desktop at /settings shows General; a phone shows the list alone.
  const shown = (): Section | null => props.section ?? (onPhone() ? null : "general");

  /** What a section holds now, as the list of sections shows it on a phone, where it is known. */
  function valueShown(section: Section): string | null {
    const settings = props.settings;
    if (section === "general") return settings && zoneCity(settings.time_zone);
    if (section === "brief-and-review") return settings && briefAndReview(settings);
    if (section === "contexts") {
      return String(props.contexts.filter((context) => !context.retired).length);
    }
    const spent = spend();
    if (section === "spend" && spent) {
      return `${money.format(spent.spent)} of ${money.format(spent.cap)}`;
    }
    return null;
  }

  function SectionLink(link: { section: Section }) {
    const { name, icon: SectionIcon } = NAMED[link.section];
    const valueId = createUniqueId();
    const value = () => (onPhone() ? valueShown(link.section) : null);
    return (
      <li>
        <a
          href={sectionAddress(link.section)}
          class="settings-section-link"
          aria-current={shown() === link.section ? "page" : undefined}
          aria-describedby={value() ? valueId : undefined}
          onClick={(event) => followed(event, () => openSettings(link.section))}
        >
          <SectionIcon size={18} class="settings-section-icon" aria-hidden="true" />
          <span class="settings-section-name">{name}</span>
          {/* Read out after the section's name, which stays its name. */}
          <Show when={value()}>
            <span id={valueId} class="settings-section-value" aria-hidden="true">
              {value()}
            </span>
          </Show>
          <Show when={onPhone()}>
            <ChevronRight size={18} class="settings-section-icon" aria-hidden="true" />
          </Show>
        </a>
      </li>
    );
  }

  /** What needs the Context's settings, said to need the network while they cannot be read. */
  const needsNetwork = () => (
    <Show when={props.offlineZone}>
      <p class="settings-note">This Context's settings and its Trash need the network.</p>
    </Show>
  );

  return (
    <div class="settings-screen">
      <Show when={!onPhone() || shown() === null}>
        <nav class="settings-sections" aria-label="Settings sections">
          <h2 class="settings-sections-heading">
            <span class="settings-accent-dot" aria-hidden="true" />
            {props.contextName}, this Context
          </h2>
          <ul>
            <For each={SECTIONS.filter((each) => NAMED[each].ofContext)}>
              {(each) => <SectionLink section={each} />}
            </For>
          </ul>
          <h2 class="settings-sections-heading">Everything in Praxis</h2>
          <ul>
            <For each={SECTIONS.filter((each) => !NAMED[each].ofContext)}>
              {(each) => <SectionLink section={each} />}
            </For>
          </ul>
        </nav>
      </Show>
      <Show when={shown()}>
        {(section) => (
          <div class="settings-shown">
            <Switch>
              <Match when={section() === "general"}>
                <Show when={props.settings} fallback={needsNetwork()}>
                  {(read) => (
                    <GeneralSettings settings={read()} onChanged={props.onSettingsChanged} />
                  )}
                </Show>
              </Match>
              <Match when={section() === "brief-and-review"}>
                <Show when={props.settings} fallback={needsNetwork()}>
                  {(read) => (
                    <BriefAndReview settings={read()} onChanged={props.onSettingsChanged} />
                  )}
                </Show>
              </Match>
              <Match when={section() === "standing"}>
                <Show
                  when={props.settings}
                  fallback={
                    // With no network the Standing Entries are the Offline Copy's.
                    <Show when={props.offlineZone}>
                      {(zone) => (
                        <>
                          {needsNetwork()}
                          <Standing timeZone={zone()} />
                        </>
                      )}
                    </Show>
                  }
                >
                  {(read) => <Standing timeZone={read().time_zone} />}
                </Show>
              </Match>
              <Match when={section() === "changes"}>
                <Show when={props.settings} fallback={needsNetwork()}>
                  {(read) => <Changes timeZone={read().time_zone} />}
                </Show>
              </Match>
              <Match when={section() === "trash"}>
                <Show when={props.settings} fallback={needsNetwork()}>
                  {(read) => <Trash timeZone={read().time_zone} />}
                </Show>
              </Match>
              <Match when={section() === "conversation-and-search"}>
                <Show when={props.settings} fallback={needsNetwork()}>
                  <ConversationAndSearch contextName={props.contextName} />
                </Show>
              </Match>
              <Match when={section() === "contexts"}>
                <Contexts
                  contexts={props.contexts}
                  onChanged={props.onContextChanged}
                  onMade={props.onContextMade}
                  onDeleted={props.onContextDeleted}
                />
              </Match>
              <Match when={section() === "connections"}>
                <Connections contexts={props.contexts} />
              </Match>
              <Match when={section() === "devices"}>
                <Devices />
              </Match>
              <Match when={section() === "spend"}>
                <SpendSettings />
              </Match>
              <Match when={section() === "backups"}>
                <section class="settings" aria-labelledby="backups-and-export-heading">
                  <h2 id="backups-and-export-heading" class="column-heading">
                    Backups and Export
                  </h2>
                  <BackupSettings />
                  <ExportSettings />
                </section>
              </Match>
            </Switch>
          </div>
        )}
      </Show>
    </div>
  );
}

/** A time zone by the place it is named for, as in "Paris" for Europe/Paris. */
function zoneCity(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}

/** When the Brief and the Review come, as in "7:00 AM · Sun", or that neither does. */
function briefAndReview(settings: ContextSettings): string {
  const brief = settings.brief_time === null ? [] : [clockTime(settings.brief_time)];
  const review = settings.review_time === null ? [] : [shortDay(settings.review_day)];
  return [...brief, ...review].join(" · ") || "Off";
}

/** A time of day, "HH:MM", as the Device's language writes it. */
function clockTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2026, 10, 16, hours, minutes));
}

/** A day of the week as the Device's language shortens it. */
function shortDay(day: Weekday): string {
  // 2026-11-16 was a Monday, and the days run from Monday.
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
    Date.UTC(2026, 10, 16) + weekdays.indexOf(day) * 24 * 60 * 60 * 1000,
  );
}
