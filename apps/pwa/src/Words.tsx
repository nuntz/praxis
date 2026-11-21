import {
  type Alignment,
  type ImageLoading,
  type MarkdownBlock,
  type MarkdownInline,
  renderMarkdown,
} from "@praxis/domain/markdown";
import ImageIcon from "lucide-solid/icons/image";
import ImageOffIcon from "lucide-solid/icons/image-off";
import { createMemo, createSignal, type JSX, Match, Switch } from "solid-js";

/**
 * Words as the screen shows them: an Entry's, and an Agent's Message's, which is shown as an
 * Entry's words are (section 8.5). They are rendered as Markdown from the fixed set of section
 * 8.4, which `renderMarkdown` lets through, and drawn here with elements of the screen's own: no
 * word ever becomes markup. Everything typed outside the set is text, as typed. How an image loads
 * is the caller's to say, from whose hand the words are (`imageLoadingIn`), and never from them.
 */
export function Words(props: { words: string; images: ImageLoading; testId?: string }) {
  // Each is drawn afresh only when it changes, so an image tapped stays shown while the Entry
  // around it changes in other ways, and a change to its words is a new showing.
  const words = createMemo(() => props.words);
  const images = createMemo(() => props.images);
  const blocks = createMemo(() => renderMarkdown(words()));
  return (
    <div class="words" data-testid={props.testId}>
      {blocks().map((shown) => block(shown, images()))}
    </div>
  );
}

/** What a block holds, each image in it loading as the words' images do. */
function inlines(all: MarkdownInline[], images: ImageLoading): JSX.Element[] {
  return all.map((shown) => inline(shown, images));
}

function block(shown: MarkdownBlock, images: ImageLoading): JSX.Element {
  switch (shown.kind) {
    case "paragraph":
      return <p>{inlines(shown.children, images)}</p>;
    case "heading":
      // Under the column's own heading and an Entry's Follow-ups, so the page's outline holds.
      if (shown.level === 1) return <h4>{inlines(shown.children, images)}</h4>;
      if (shown.level === 2) return <h5>{inlines(shown.children, images)}</h5>;
      return <h6>{inlines(shown.children, images)}</h6>;
    case "quote":
      return <blockquote>{shown.children.map((child) => block(child, images))}</blockquote>;
    case "list": {
      const items = shown.items.map((item) => <li>{item.map((child) => block(child, images))}</li>);
      return shown.ordered ? <ol start={shown.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "code_block":
      // It scrolls sideways and never wraps, so it is reached by keyboard to be scrolled.
      return (
        <pre tabindex="0">
          <code>{shown.text}</code>
        </pre>
      );
    case "table":
      // A table wider than its column scrolls sideways inside the Entry, by keyboard too.
      return (
        <div class="table-scroll" tabindex="0">
          <table>
            <thead>
              <tr>
                {shown.head.map((cell, column) => (
                  <th class={aligned(shown.align[column])}>{inlines(cell, images)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((row) => (
                <tr>
                  {row.map((cell, column) => (
                    <td class={aligned(shown.align[column])}>{inlines(cell, images)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "typed":
      return <p class="typed">{shown.text}</p>;
  }
}

/** A cell's column aligned as typed, by a class, since the words never set a style. */
function aligned(align: Alignment | undefined): string | undefined {
  return align ? `align-${align}` : undefined;
}

function inline(shown: MarkdownInline, images: ImageLoading): JSX.Element {
  switch (shown.kind) {
    case "text":
      return shown.text;
    case "break":
      return <br />;
    case "emphasis":
      return <em>{inlines(shown.children, images)}</em>;
    case "strong":
      return <strong>{inlines(shown.children, images)}</strong>;
    case "code":
      return <code class="code-span">{shown.text}</code>;
    case "link":
      // It opens in a new tab and sends no referrer.
      return (
        <a href={shown.href} target="_blank" rel="noreferrer">
          {inlines(shown.children, images)}
        </a>
      );
    case "image":
      return <Image src={shown.src} description={shown.description} loading={images} />;
  }
}

/**
 * An image, by its address (section 8.4): loaded, with no frame, or one line, its icon and its
 * description, saying "Show image" while it waits for a tap, or that it did not load, with its
 * address as a link. A tap loads it for this showing and is not remembered. One that never loads,
 * as in a Message, is its description with nothing to tap.
 */
function Image(props: { src: string; description: string; loading: ImageLoading }) {
  const description = props.description || "An image";
  const [state, setState] = createSignal<"waiting" | "shown" | "failed">(
    props.loading === "by_itself" ? "shown" : "waiting",
  );
  return (
    <Switch>
      <Match when={state() === "shown"}>
        {/* Its host learns when it was shown, and not from which page. */}
        <img
          class="words-image-loaded"
          src={props.src}
          alt={description}
          referrerpolicy="no-referrer"
          onError={() => setState("failed")}
        />
      </Match>
      <Match when={state() === "failed"}>
        <ImageLine icon={ImageOffIcon} description={description}>
          <span>did not load</span>
          <a href={props.src} target="_blank" rel="noreferrer">
            {props.src.replace(/^https:\/\//i, "")}
          </a>
        </ImageLine>
      </Match>
      <Match when={state() === "waiting"}>
        <ImageLine icon={ImageIcon} description={description}>
          {props.loading === "on_tap" && (
            <button
              type="button"
              class="words-image-show"
              aria-label={`Show image ${description}`}
              onClick={() => setState("shown")}
            >
              Show image
            </button>
          )}
        </ImageLine>
      </Match>
    </Switch>
  );
}

/** An image as one line: its icon in the muted colour, its description, then what follows. */
function ImageLine(props: { icon: typeof ImageIcon; description: string; children?: JSX.Element }) {
  return (
    <span class="words-image" data-testid="image-line">
      <props.icon size={18} aria-hidden="true" />
      <span class="words-image-description">{props.description}</span>
      {props.children}
    </span>
  );
}
