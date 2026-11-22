import type { ContextListing, Settings as ContextSettings, Entry } from "@praxis/domain";
import type { LucideIcon } from "lucide-solid";
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
import ChangesIcon from "lucide-solid/icons/rotate-ccw-clock";
import Smartphone from "lucide-solid/icons/smartphone";
import Sunrise from "lucide-solid/icons/sunrise";
import TrashIcon from "lucide-solid/icons/trash";
import { createEffect, createUniqueId, For, type JSX, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { BackupSettings } from "./Backups.tsx";
import { Changes } from "./Changes.tsx";
import { Connections } from "./Connections.tsx";
import {
  BriefAndReview,
  ConversationAndSearch,
  GeneralSettings,
  weekdayName,
} from "./ContextSettings.tsx";
import { Contexts } from "./Contexts.tsx";
import { Devices } from "./Devices.tsx";
import { ExportSettings } from "./Export.tsx";
import { latestRead } from "./latest-read.ts";
import { onPhone } from "./media.ts";
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
import { type CallTool, callDeploymentTool, useCallTool } from "./tools.ts";

type SettingsProps = {
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
};

/** What a section is shown from: Settings' own props, and what needs the network saying so. */
type ShownFrom = { props: SettingsProps; needsNetwork: () => JSX.Element };

/** Each section of Settings, as the screen lists it and shows it. */
type SectionShown = {
  name: string;
  icon: LucideIcon;
  /** The current Context's section, or the Deployment's. */
  ofContext: boolean;
  /** What it holds now, as the phone's list of sections shows it, where the screen knows it. */
  value?: (props: SettingsProps) => string | null;
  /** What it holds now, where only a read of its own tells: a value of its own, or none. */
  read?: (callTool: CallTool) => Promise<string | null>;
  /** The section itself. */
  panel: (from: ShownFrom) => JSX.Element;
};

/** A section that needs the Context's settings, which says it needs the network while unread. */
function withSettings(from: ShownFrom, panel: (settings: () => ContextSettings) => JSX.Element) {
  return (
    <Show when={from.props.settings} fallback={from.needsNetwork()}>
      {(read) => panel(read)}
    </Show>
  );
}

/** Each section, in the order Settings lists them. */
const SHOWN: Record<Section, SectionShown> = {
  general: {
    name: "General",
    icon: Globe,
    ofContext: true,
    value: (props) => props.settings && zoneCity(props.settings.time_zone),
    panel: (from) =>
      withSettings(from, (settings) => (
        <GeneralSettings settings={settings()} onChanged={from.props.onSettingsChanged} />
      )),
  },
  "brief-and-review": {
    name: "Brief and Review",
    icon: Sunrise,
    ofContext: true,
    value: (props) => props.settings && briefAndReview(props.settings),
    panel: (from) =>
      withSettings(from, (settings) => (
        <BriefAndReview settings={settings()} onChanged={from.props.onSettingsChanged} />
      )),
  },
  standing: {
    name: "Standing Entries",
    icon: Pin,
    ofContext: true,
    async read(callTool) {
      const read: Entry[] = [];
      let cursor: string | null | undefined;
      do {
        const result = await callTool("list_entries", {
          standing: true,
          ...(cursor ? { cursor } : {}),
        });
        if (!result.ok) return null;
        read.push(...result.value.items);
        cursor = result.value.next_cursor;
      } while (cursor);
      return read.length === 0 ? "None" : String(read.length);
    },
    panel: (from) => (
      <Show
        when={from.props.settings}
        fallback={
          // With no network the Standing Entries are the Offline Copy's.
          <Show when={from.props.offlineZone}>
            {(zone) => (
              <>
                {from.needsNetwork()}
                <Standing timeZone={zone()} />
              </>
            )}
          </Show>
        }
      >
        {(read) => <Standing timeZone={read().time_zone} />}
      </Show>
    ),
  },
  changes: {
    name: "Changes",
    icon: ChangesIcon,
    ofContext: true,
    panel: (from) => withSettings(from, (settings) => <Changes timeZone={settings().time_zone} />),
  },
  trash: {
    name: "Trash",
    icon: TrashIcon,
    ofContext: true,
    async read(callTool) {
      const result = await callTool("list_trash", {});
      if (!result.ok) return null;
      const { items, next_cursor } = result.value;
      if (items.length === 0) return "Empty";
      return next_cursor === null ? String(items.length) : `${items.length}+`;
    },
    panel: (from) => withSettings(from, (settings) => <Trash timeZone={settings().time_zone} />),
  },
  "conversation-and-search": {
    name: "Conversation and search",
    icon: MessageCircle,
    ofContext: true,
    panel: (from) =>
      withSettings(from, () => <ConversationAndSearch contextName={from.props.contextName} />),
  },
  contexts: {
    name: "Contexts",
    icon: Layers,
    ofContext: false,
    value: (props) => String(props.contexts.filter((context) => !context.retired).length),
    panel: ({ props }) => (
      <Contexts
        contexts={props.contexts}
        onChanged={props.onContextChanged}
        onMade={props.onContextMade}
        onDeleted={props.onContextDeleted}
      />
    ),
  },
  connections: {
    name: "Connections",
    icon: Plug,
    ofContext: false,
    async read() {
      const result = await callDeploymentTool("list_connections", {});
      return result.ok ? String(result.value.items.length) : null;
    },
    panel: ({ props }) => <Connections contexts={props.contexts} />,
  },
  devices: {
    name: "Devices",
    icon: Smartphone,
    ofContext: false,
    async read() {
      const result = await callDeploymentTool("list_devices", {});
      return result.ok ? String(result.value.items.length) : null;
    },
    panel: () => <Devices />,
  },
  spend: {
    name: "Spend",
    icon: Gauge,
    ofContext: false,
    value: () => {
      const spent = spend();
      return spent && `${money.format(spent.spent)} of ${money.format(spent.cap)}`;
    },
    panel: () => <SpendSettings />,
  },
  backups: {
    name: "Backups and Export",
    icon: Archive,
    ofContext: false,
    async read() {
      const result = await callDeploymentTool("get_last_backup", {});
      if (!result.ok) return null;
      const made = result.value.made_at;
      return made === null ? "None" : backupDay.format(new Date(made));
    },
    panel: () => (
      <section class="settings" aria-labelledby="backups-and-export-heading">
        <h2 id="backups-and-export-heading" class="column-heading">
          Backups and Export
        </h2>
        <BackupSettings />
        <ExportSettings />
      </section>
    ),
  },
};

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
 * as a list of their own on a phone, each opening from it with what it holds now. Each section is
 * one of the screen's panels; with the Context's settings not read, those that need them say they
 * need the network, and the Standing Entries are the Offline Copy's.
 */
export function SettingsScreen(props: SettingsProps) {
  // A desktop at /settings shows General; a phone shows the list alone.
  const shown = (): Section | null => props.section ?? (onPhone() ? null : "general");
  // What only a read of its own tells, read each time the phone's list of sections shows.
  const listed = readListed(useCallTool());
  createEffect(() => {
    if (onPhone() && shown() === null) void listed.read();
  });

  function SectionLink(link: { section: Section }) {
    const { name, icon: SectionIcon, value: known } = SHOWN[link.section];
    const valueId = createUniqueId();
    const value = () => {
      if (!onPhone()) return null;
      return known ? known(props) : (listed.values[link.section] ?? null);
    };
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

  const from: ShownFrom = {
    props,
    needsNetwork: () => (
      <Show when={props.offlineZone}>
        <p class="settings-note">This Context's settings and its Trash need the network.</p>
      </Show>
    ),
  };

  return (
    <div class="settings-screen">
      <Show when={!onPhone() || shown() === null}>
        <nav class="settings-sections" aria-label="Settings sections">
          <h2 class="settings-sections-heading">
            <span class="settings-accent-dot" aria-hidden="true" />
            {props.contextName}, this Context
          </h2>
          <ul>
            <For each={SECTIONS.filter((each) => SHOWN[each].ofContext)}>
              {(each) => <SectionLink section={each} />}
            </For>
          </ul>
          <h2 class="settings-sections-heading">Everything in Praxis</h2>
          <ul>
            <For each={SECTIONS.filter((each) => !SHOWN[each].ofContext)}>
              {(each) => <SectionLink section={each} />}
            </For>
          </ul>
        </nav>
      </Show>
      <Show when={shown()} keyed>
        {(section) => <div class="settings-shown">{SHOWN[section].panel(from)}</div>}
      </Show>
    </div>
  );
}

/**
 * Read what the phone's list of sections shows of the sections a read of their own tells, each by
 * its section's read. A value whose read fails is shown as last read, or not at all; the last
 * read's answers win (CODING_STANDARDS.md, Reads and changes).
 */
function readListed(callTool: CallTool) {
  const [values, setValues] = createStore<Partial<Record<Section, string>>>({});
  const { read } = latestRead((current) =>
    Promise.all(
      SECTIONS.map(async (section) => {
        try {
          const value = await SHOWN[section].read?.(callTool);
          if (current() && value) setValues(section, value);
        } catch {
          // Not reached: what was read before stays, if anything was.
        }
      }),
    ),
  );
  return { values, read };
}

/** The day of a Backup, on this Device, as in "Nov 21". */
const backupDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A time zone by the place it is named for, as in "Paris" for Europe/Paris. */
function zoneCity(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}

/** When the Brief and the Review come, as in "7:00 AM · Sun", or that neither does. */
function briefAndReview(settings: ContextSettings): string {
  const brief = settings.brief_time === null ? [] : [timeOfDay(settings.brief_time)];
  const review = settings.review_time === null ? [] : [weekdayName(settings.review_day, "short")];
  return [...brief, ...review].join(" · ") || "Off";
}

/** A time of day, "HH:MM", as the Device's language writes it. */
function timeOfDay(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(1970, 0, 1, hours, minutes));
}
