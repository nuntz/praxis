import type { ContextListing, Settings as ContextSettings } from "@praxis/domain";
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
import { createEffect, createUniqueId, For, type JSX, on, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { BackupsAndExport, backupsListed } from "./Backups.tsx";
import { Changes } from "./Changes.tsx";
import { Connections, connectionsListed } from "./Connections.tsx";
import {
  BriefAndReview,
  briefAndReviewListed,
  ConversationAndSearch,
  GeneralSettings,
  generalListed,
} from "./ContextSettings.tsx";
import { Contexts, contextsListed } from "./Contexts.tsx";
import { Devices, devicesListed } from "./Devices.tsx";
import { latestRead } from "./latest-read.ts";
import { onPhone } from "./media.ts";
import {
  followed,
  leaveSettings,
  openSettings,
  SECTIONS,
  type Section,
  sectionAddress,
} from "./place.ts";
import { SettingsSection, ShownSection } from "./SettingsSection.tsx";
import { SpendSettings, spendListed } from "./Spend.tsx";
import { Standing, standingListed } from "./Standing.tsx";
import { Trash, trashListed } from "./Trash.tsx";
import { type CallTool, useCallTool } from "./tools.ts";

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
  /**
   * Says a problem on the screen, for a section that has left it, as what the Trash, Contexts,
   * Connections and Conversation and search marked does when it cannot be sent (ADR 0028).
   */
  onProblem: (message: string) => void;
};

/** What a section is shown from: Settings' own props, and what needs the network saying so. */
type ShownFrom = { props: SettingsProps; needsNetwork: () => JSX.Element };

/** Each section of Settings, as the screen lists it and shows it. */
type SectionShown = {
  name: string;
  icon: LucideIcon;
  /** The current Context's section, or the Deployment's. */
  ofContext: boolean;
  /**
   * What it holds now, as the phone's list of sections shows it, where the screen knows it: a
   * count only above zero (`listedCount`), or a state such as "Off". Each section's own module
   * gives it.
   */
  value?: (props: SettingsProps) => string | null;
  /** What it holds now, where only a read of its own tells: as `value` does, or null unread. */
  read?: (callTool: CallTool) => Promise<string | null>;
  /** The section itself. */
  panel: (from: ShownFrom) => JSX.Element;
};

/** A section that needs the Context's settings, which says it needs the network while unread. */
function withSettings(from: ShownFrom, panel: (settings: () => ContextSettings) => JSX.Element) {
  return (
    <Show when={from.props.settings} fallback={<SettingsSection note={from.needsNetwork()} />}>
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
    value: (props) => props.settings && generalListed(props.settings),
    panel: (from) =>
      withSettings(from, (settings) => (
        <GeneralSettings settings={settings()} onChanged={from.props.onSettingsChanged} />
      )),
  },
  "brief-and-review": {
    name: "Brief and Review",
    icon: Sunrise,
    ofContext: true,
    value: (props) => props.settings && briefAndReviewListed(props.settings),
    panel: (from) =>
      withSettings(from, (settings) => (
        <BriefAndReview settings={settings()} onChanged={from.props.onSettingsChanged} />
      )),
  },
  standing: {
    name: "Standing Entries",
    icon: Pin,
    ofContext: true,
    read: standingListed,
    panel: (from) => (
      <Show
        when={from.props.settings}
        fallback={
          // With no network the Standing Entries are the Offline Copy's.
          <Show when={from.props.offlineZone}>
            {(zone) => <Standing timeZone={zone()} note={from.needsNetwork()} />}
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
    read: trashListed,
    panel: (from) =>
      withSettings(from, (settings) => (
        <Trash timeZone={settings().time_zone} onProblem={from.props.onProblem} />
      )),
  },
  "conversation-and-search": {
    name: "Conversation and search",
    icon: MessageCircle,
    ofContext: true,
    panel: (from) =>
      withSettings(from, () => (
        <ConversationAndSearch
          contextName={from.props.contextName}
          onProblem={from.props.onProblem}
        />
      )),
  },
  contexts: {
    name: "Contexts",
    icon: Layers,
    ofContext: false,
    value: (props) => contextsListed(props.contexts),
    panel: ({ props }) => (
      <Contexts
        contexts={props.contexts}
        onChanged={props.onContextChanged}
        onMade={props.onContextMade}
        onDeleted={props.onContextDeleted}
        onProblem={props.onProblem}
      />
    ),
  },
  connections: {
    name: "Connections",
    icon: Plug,
    ofContext: false,
    read: connectionsListed,
    panel: ({ props }) => <Connections contexts={props.contexts} onProblem={props.onProblem} />,
  },
  devices: {
    name: "Devices",
    icon: Smartphone,
    ofContext: false,
    read: devicesListed,
    panel: () => <Devices />,
  },
  spend: {
    name: "Spend",
    icon: Gauge,
    ofContext: false,
    value: spendListed,
    panel: () => <SpendSettings />,
  },
  backups: {
    name: "Backups and Export",
    icon: Archive,
    ofContext: false,
    read: backupsListed,
    panel: () => <BackupsAndExport />,
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

  // Opening a section puts the focus on its heading; on a phone, going back to the list puts it on
  // the row of the section left (section 8.6). Settings opened afresh leaves the focus alone.
  const links: Partial<Record<Section, HTMLAnchorElement>> = {};
  let heading: HTMLHeadingElement | undefined;
  createEffect(
    on(
      shown,
      (now, was) => {
        if (now !== null) heading?.focus();
        else if (was) links[was]?.focus();
      },
      { defer: true },
    ),
  );

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
          ref={(element) => {
            links[link.section] = element;
          }}
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
      <Show when={props.offlineZone}>This Context's settings and its Trash need the network.</Show>
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
        {(section) => (
          <div class="settings-shown">
            <ShownSection.Provider
              value={{
                section,
                name: SHOWN[section].name,
                heading: (drawn) => {
                  heading = drawn;
                },
              }}
            >
              {SHOWN[section].panel(from)}
            </ShownSection.Provider>
          </div>
        )}
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
          if (current() && value !== null && value !== undefined) setValues(section, value);
        } catch {
          // Not reached: what was read before stays, if anything was.
        }
      }),
    ),
  );
  return { values, read };
}
