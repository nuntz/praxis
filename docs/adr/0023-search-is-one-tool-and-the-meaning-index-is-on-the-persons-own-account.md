# Search is one tool and the meaning index is on the person's own account

There is one `search` tool, the same for the person's hand, the Agent and a Connection, and it returns one ranked list from words and from meaning with no mode for the caller to pick. The words index is inside the Context's object. The meaning index is outside it, kept per Context, in Vectorize with embeddings from Workers AI, both on the person's own Cloudflare account. We decided this because a caller that has to choose between two kinds of search chooses wrongly, a model most of all; and because the meaning index is the one place a Journal's words are worked on outside its object, so it stays on the account the person already trusts with the Journal, and no further provider sees them.

## Considered Options

- **Two tools, or a mode on one**, for words and for meaning. Rejected: every caller would have to know which to use, and the Agent would be asked to guess.
- **Embeddings from the Agent's model provider or another third party.** Rejected: every Entry would go to a provider for a purpose the person did not start, and search by meaning would need a key.
- **Words only.** Rejected: the Agent has no memory of its own (ADR 0016), so finding an Entry by what it is about, not by the words it happens to use, is what stands in for one.

## Consequences

- Meaning applies to Entries only. Tasks, Projects and Persons are found by words. The Trash, Versions and the Conversation are never searched.
- The meaning index is derived and can be rebuilt (ADR 0006). When it is missing or stale, search answers from words and tells every caller that it did.
- A saved Entry is findable by words at once and by meaning shortly after. A deleted Entry leaves both indexes at once as every caller sees them: its embedding stays in the meaning index while it is in the Trash, never returned, so a restore costs no embedding, and one removed for good leaves it.
- The meaning index is one Vectorize index for the Deployment with a part per Context. Vectorize keeps no index in a jurisdiction, so a Deployment that chose one keeps its embeddings wherever Cloudflare keeps the index.
- The embedding model is fixed in code and is not configuration. A release that changes it marks every meaning index stale, and each is rebuilt.
- Embedding costs money on the person's account, counts toward the cap and stops at it (ADR 0017): at the cap, search answers from words and says so.
- Nothing crosses a Context (ADR 0003): each Context has its own part of the meaning index, and deleting a Context removes its part.
