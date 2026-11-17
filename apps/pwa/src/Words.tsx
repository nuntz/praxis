/**
 * Words as the screen shows them: an Entry's, and an Agent's Message's, which is shown as an
 * Entry's words are (section 8.5). One place, so both are rendered alike once Markdown is (#53).
 */
export function Words(props: { words: string; testId?: string }) {
  return (
    <p class="entry-words" data-testid={props.testId}>
      {props.words}
    </p>
  );
}
