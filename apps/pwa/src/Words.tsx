import {
  type Alignment,
  type MarkdownBlock,
  type MarkdownInline,
  renderMarkdown,
} from "@praxis/domain/markdown";
import ImageIcon from "lucide-solid/icons/image";
import { createMemo, type JSX } from "solid-js";

/**
 * Words as the screen shows them: an Entry's, and an Agent's Message's, which is shown as an
 * Entry's words are (section 8.5). They are rendered as Markdown from the fixed set of section
 * 8.4, which `renderMarkdown` lets through, and drawn here with elements of the screen's own: no
 * word ever becomes markup. Everything typed outside the set is text, as typed.
 */
export function Words(props: { words: string; testId?: string }) {
  const blocks = createMemo(() => renderMarkdown(props.words));
  return (
    <div class="words" data-testid={props.testId}>
      {blocks().map(block)}
    </div>
  );
}

function block(shown: MarkdownBlock): JSX.Element {
  switch (shown.kind) {
    case "paragraph":
      return <p>{shown.children.map(inline)}</p>;
    case "heading":
      // Under the column's own heading and an Entry's Follow-ups, so the page's outline holds.
      if (shown.level === 1) return <h4>{shown.children.map(inline)}</h4>;
      if (shown.level === 2) return <h5>{shown.children.map(inline)}</h5>;
      return <h6>{shown.children.map(inline)}</h6>;
    case "quote":
      return <blockquote>{shown.children.map(block)}</blockquote>;
    case "list": {
      const items = shown.items.map((item) => <li>{item.map(block)}</li>);
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
                  <th class={aligned(shown.align[column])}>{cell.map(inline)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((row) => (
                <tr>
                  {row.map((cell, column) => (
                    <td class={aligned(shown.align[column])}>{cell.map(inline)}</td>
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

function inline(shown: MarkdownInline): JSX.Element {
  switch (shown.kind) {
    case "text":
      return shown.text;
    case "break":
      return <br />;
    case "emphasis":
      return <em>{shown.children.map(inline)}</em>;
    case "strong":
      return <strong>{shown.children.map(inline)}</strong>;
    case "code":
      return <code class="code-span">{shown.text}</code>;
    case "link":
      // It opens in a new tab and sends no referrer.
      return (
        <a href={shown.href} target="_blank" rel="noreferrer">
          {shown.children.map(inline)}
        </a>
      );
    case "image":
      // Shown by its description, and nothing loads from its address, until an image can (#54).
      return (
        <span class="words-image">
          <ImageIcon size={18} aria-hidden="true" />
          <span class="words-image-description">{shown.description || "An image"}</span>
        </span>
      );
  }
}
