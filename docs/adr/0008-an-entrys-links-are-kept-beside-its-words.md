# An Entry's links are kept beside its words

A Reference or a Mention is a record kept beside an Entry's words, optionally anchored to a span of them, and a tool takes links as a list next to the words. The words themselves hold no ids and the server never reads them to find links. We decided this because the person's words are the one thing the Agent may not change without a tap, and an Agent that cannot link an old Entry to a Task without rewording it would either be useless at filing or leave a Held Change for every link.

## Considered Options

- **Markers in the words, read out by the server on every save.** Rejected: the links would always match the text, but adding one is then a change to the person's words, and the Journal's text would carry ids that mean nothing outside Praxis.
- **Both**, links in the words and beside them. Rejected: two sources for one fact, and a rule needed for when they disagree.

## Consequences

- Adding or removing a Reference or Mention is never a Held Change and makes no new version of the Entry.
- The editor turns what the person types to link something into the list of links, using a parser in the domain package. The same holds for an Inline Task.
- An anchor to a span can go stale when the words are edited. An edit moves each anchor along with what it changes before the span, and a link whose span the edit touches stays on the Entry without an anchor.
- An export of an Entry is its plain words plus its links as data, so the words read the same anywhere.
