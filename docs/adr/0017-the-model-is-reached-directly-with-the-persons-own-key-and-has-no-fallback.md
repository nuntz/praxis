# The model is reached directly with the person's own key and has no fallback

The Agent runs on one model from one provider, paid for by the person's own API key with that provider. The Worker calls the provider directly, with no gateway in between, and there is no second model or provider to fall back to. The key is a secret in the deployment's configuration outside the repo and reaches the Worker as a secret on deploy; it is never stored in an object and no tool or screen reads or sets it. The model is named in the same configuration and must be one the code ships a price for. We decided this because a deployment is one person on their own accounts, so the bill and the provider's spend limit should be theirs; because a gateway's logs are a copy of the Conversation's text outside its object, which ADR 0010 rules out; and because a fallback changes how the Agent behaves without the person knowing, and needs a second key and a second set of evals.

## Considered Options

- **Billing the model through Cloudflare**, by AI Gateway. Rejected: one bill, but one more party that sees the traffic, and the provider's own spend limit is no longer the backstop.
- **AI Gateway in front of the person's key**, for logs, caching and fallback. Rejected: its logs hold the Conversation's text, and spend and failures are already in Run records.
- **A fallback model or provider** when the first is down. Rejected: a second key, a second set of evals, and an Agent that acts differently on some days.
- **Entering the key in a settings screen.** Rejected: a write path for a secret through the Worker, and a copy in storage that export, backup and the Trash would each have to skip.
- **Any model the provider offers.** Rejected: a Run on a model with no shipped price cannot be counted against the cap.
- **Queueing a Message to be answered when the model returns.** Rejected: an answer an hour late may act on a request the person has moved on from.

## Consequences

- Changing the key or the model is a change to the deployment's configuration and a deploy, not something done in Praxis. A model with no shipped price fails the deploy with the reason.
- The key is optional. Without one there is no Agent: the Conversation says so in place of its composer and no Brief or Review is ever due. The Journal, the screen, Connections and search work as normal, and nothing is shown as broken.
- When the model cannot be reached, a Run started by the person retries for seconds and then ends as failed. The person's Message stays, with a notice under it that is not a Message and a way to try again. Nothing is answered later by itself.
- Praxis tells two failures apart. The provider being unavailable shows only on the Run that failed. The provider refusing the key, whether the key is wrong, out of credit or at the provider's own limit, is a standing notice in attention and in settings until a call succeeds.
- At the cap the Conversation's composer is replaced by the notice, which links to the cap in settings. The Journal's composer is untouched.
- A Brief or Review that was due retries with a growing gap during an outage, and at the cap waits for the cap to be raised or the month to turn. Either way it is dropped once the next one is due, attention shows one line with the reason, and no Notification is sent.
- A Connection sees nothing of the cap or an outage, since no tool it calls starts a Run. Search tells every caller when it answered from words only.
- At the cap, embedding of newly saved Entries stops too. Those Entries are found by words, and the meaning index catches up once the cap lifts.
