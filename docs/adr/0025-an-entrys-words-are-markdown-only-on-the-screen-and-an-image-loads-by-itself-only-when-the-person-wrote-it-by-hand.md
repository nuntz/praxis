# An Entry's words are Markdown only on the screen, and an image loads by itself only when the person wrote it by hand

An Entry's words are stored exactly as typed and the server never reads them. The screen shows them as Markdown, from a fixed set with CommonMark's syntax: emphasis, code, links, lists, quotes, headings, tables and images. Raw HTML is shown as typed. An image is given by its `https` address and Praxis keeps none of its bytes. It loads by itself only in an Entry whose Author is the person and which did not come through the Conversation. In any other Entry it shows its description and waits for a tap, and in a Message it never loads. We decided this because showing an image makes the person's browser call a third party, which is the one place the screen does so, and an address can carry words out. A Connection that writes could record an Entry telling the Agent to put Journal text into an image's address, and the browser would send it when the Entry or the Message was shown.

## Considered Options

- **Plain text only**, as before. Rejected: the person already types lists, links and emphasis, and the Agent's model writes Markdown whether asked to or not.
- **Markdown the server understands**, stored as a parsed form. Rejected: the server would read words, which ADR 0008 rules out, and the stored words would no longer be what was typed.
- **All of CommonMark or GFM, with raw HTML sanitised.** Rejected: a sanitiser is a standing risk for nothing a Journal Entry needs.
- **Every image loads by itself.** Rejected: it leaves the way out open.
- **Every image waits for a tap.** Rejected: safest, but tiresome for the person's own photos, and the Entry already carries the two facts that tell their hand from anyone else's.
- **Praxis fetches and keeps the image.** Rejected: that is an attachment, which is out of scope, and it would make Praxis fetch from an address someone else chose.

## Consequences

- Search, Versions, a Held Change, the Export and a Connection all see the words as typed. Only an Entry in the Journal and a Message from the Agent are rendered.
- Editing an Entry makes it the person's, so its images then load by themselves. That is how the person vouches for an Entry they did not write.
- A tap loads one image for one showing and is not remembered.
- Offline, an image shows its description. The Offline Copy and the service worker hold no image.
- The content security policy allows images from any `https` host. Nothing else new is allowed.
- A leading `- ` is a list item and no longer an Inline Task. `- [ ]` is accepted in its place.
- Nothing is checked on a write: words are never refused for their Markdown.
- An image's host learns when and from where an Entry was shown. The person accepts that for what they wrote by hand.
