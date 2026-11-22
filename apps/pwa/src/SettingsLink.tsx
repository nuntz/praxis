import type { JSX } from "solid-js";
import { followed, openSettings, type Section, sectionAddress } from "./place.ts";

/** The id of the spend cap's field in Spend, where a link to raise the cap puts the person. */
export const CAP_FIELD = "spend-cap";

/**
 * A link to a section of Settings (section 8.6), at the section's address, opened as the screen
 * opens it. With a field named by its id, the person is put in that field once the section shows.
 */
export function SettingsLink(props: { section: Section; field?: string; children: JSX.Element }) {
  function open() {
    openSettings(props.section);
    const field = props.field;
    if (field === undefined) return;
    requestAnimationFrame(() => {
      const shown = document.getElementById(field);
      shown?.scrollIntoView({ block: "center" });
      shown?.focus();
    });
  }
  return (
    <a
      href={sectionAddress(props.section)}
      class="settings-link"
      onClick={(event) => followed(event, open)}
    >
      {props.children}
    </a>
  );
}

/** The way to the spend cap, from a Notice that the cap is reached or nearly. */
export function CapLink() {
  return (
    <SettingsLink section="spend" field={CAP_FIELD}>
      Raise the cap in settings
    </SettingsLink>
  );
}
