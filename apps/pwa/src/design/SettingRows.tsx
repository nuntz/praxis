import { createUniqueId, For, type JSX, Match, Show, Switch, splitProps } from "solid-js";

/**
 * A group of settings, as the design system's Settings pattern draws it: a heading in `muted`,
 * then a `surface` box of rows parted by hairlines, and under it what went wrong with a change
 * made in it, said once as an alert. It is a group, named by its heading; one that is a part of
 * its section on its own, as Backups and Export are of theirs, is a region instead. One that lists
 * something, as Contexts does, is a list named by its heading, one row for each item, and says in
 * one line in its box's place that it holds none.
 */
export function SettingsGroup<T>(props: {
  heading: string;
  children?: JSX.Element;
  /** A part of its section on its own: a region, by this id, rather than a group. */
  region?: string;
  /** What it lists: each item, the row drawn for it, an `<li>`, and what it says with none. */
  list?: { each: readonly T[]; row: (item: T) => JSX.Element; empty: JSX.Element };
  /** What went wrong with a change made in it, under the box. */
  problem?: string | null | undefined;
  /** Under the box, after the problem. */
  below?: JSX.Element;
}) {
  const headingId = createUniqueId();
  return (
    <Switch
      fallback={
        <fieldset class="settings-rows">
          <legend class="settings-rows-heading">{props.heading}</legend>
          <div class="settings-box">{props.children}</div>
          <Problem message={props.problem} />
          {props.below}
        </fieldset>
      }
    >
      <Match when={props.list}>
        {(list) => (
          <div class="settings-rows">
            <h3 id={headingId} class="settings-rows-heading">
              {props.heading}
            </h3>
            <Show
              when={list().each.length > 0}
              fallback={<p class="settings-note settings-none">{list().empty}</p>}
            >
              <ul class="settings-box" aria-labelledby={headingId}>
                <For each={list().each}>{(item) => list().row(item)}</For>
              </ul>
            </Show>
            <Problem message={props.problem} />
            {props.below}
          </div>
        )}
      </Match>
      <Match when={props.region}>
        {(id) => (
          <section id={id()} class="settings-group" aria-labelledby={`${id()}-heading`}>
            <h3 id={`${id()}-heading`} class="settings-rows-heading">
              {props.heading}
            </h3>
            <div class="settings-box">{props.children}</div>
            <Problem message={props.problem} />
            {props.below}
          </section>
        )}
      </Match>
    </Switch>
  );
}

/** What went wrong, said where it happened as an alert, or nothing. */
export function Problem(props: { message: string | null | undefined }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <p class="problem" role="alert">
          {message()}
        </p>
      )}
    </Show>
  );
}

/**
 * One setting in its group's box: its words on the left, its name and what it does, and its
 * control on the right. A field or a switch is labelled by the name and described by the words
 * under it, so tapping the name reaches it; a button names itself, and the row only says why.
 */
export function SettingRow(props: {
  title: JSX.Element;
  description?: JSX.Element;
  /** The control, given the ids that label and describe a field or a switch; none says why not. */
  control?: (ids: { id: string; describedBy: string | undefined }) => JSX.Element;
  /** Whether the control is a field or a switch the name labels, rather than a button. */
  labels?: boolean;
  /** The labelled control's id, where something else reaches it by its own. */
  id?: string;
}) {
  const id = props.id ?? createUniqueId();
  const described = createUniqueId();
  return (
    <div class="settings-row">
      <div class="settings-row-words">
        <Show when={props.labels} fallback={<span class="settings-row-title">{props.title}</span>}>
          <label for={id} class="settings-row-title">
            {props.title}
          </label>
        </Show>
        <Show when={props.description}>
          <span id={described} class="settings-row-note">
            {props.description}
          </span>
        </Show>
      </div>
      <Show when={props.control}>
        {(control) => (
          <div class="settings-row-control">
            {control()({ id, describedBy: props.description ? described : undefined })}
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * A switch, as the design system draws it, never a checkbox: a native checkbox with the switch
 * role, so it keeps the checkbox's keyboard, Space turning it, and its form behaviour. Turned, it
 * is given to `onTurn`, and put back as it was when the change it was turned for did not go
 * through, or was not made yet, as `onTurn` answers.
 */
export function SwitchInput(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "role"> & {
    /** The switch was turned on or off: whether the change it was turned for went through. */
    onTurn?: (on: boolean) => Promise<boolean> | boolean;
  },
) {
  const [own, input] = splitProps(props, ["onTurn"]);
  return (
    <input
      {...input}
      type="checkbox"
      // biome-ignore lint/a11y/useAriaPropsForRole: a checkbox says whether it is on by its own checked state, which aria-checked would only contradict (ARIA in HTML).
      role="switch"
      class="switch"
      onChange={(event) => {
        const toggle = event.currentTarget;
        const on = toggle.checked;
        if (!own.onTurn) return;
        void Promise.resolve(own.onTurn(on)).then((done) => {
          if (!done) toggle.checked = !on;
        });
      }}
    />
  );
}
