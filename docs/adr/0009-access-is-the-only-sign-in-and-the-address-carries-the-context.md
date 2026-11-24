# Access is the only sign-in, and a Connection's address carries its Context

Every caller of Praxis signs in through Cloudflare Access: the person's browser, a hosted MCP client such as Claude or ChatGPT, and a local one such as Claude Code. Web and MCP share one hostname behind one Access application with managed OAuth switched on, and the Worker holds no OAuth code and no keys. Because Access shows no Praxis screen during sign-in, the Context is chosen before it: the person makes a Connection in Praxis, picking a Context and whether it is limited to reading, and is given an address under `/mcp` to paste into the client. The address is the choice. We decided this because a public authorization server would be the largest piece of security-critical code Praxis could own, and it would buy only a consent screen.

## Considered Options

- **The Worker as its own OAuth server, with the MCP paths outside Access.** Rejected: the person would pick the Context on a Praxis consent screen at the moment of authorising, but Praxis would own a public authorization server, each person would set up a second Access application, and client registration schemes would be Praxis's to keep up with.
- **A static credential, alone or beside OAuth.** Rejected: a second sign-in path with its own rotation and revocation rules. An Access service token carries no identity for the person, and hosted clients cannot send one. A caller with no browser to sign in through cannot connect.
- **An Access MCP server portal.** Rejected: built for organisations, and adds a hop and a tool timeout.
- **One address for every client, the Context given afterwards.** Rejected: a client would finish sign-in and then have every call refused until the person went to Praxis to give it a Context.
- **Tying an address to the first client that signs in through it.** Rejected: a client that registers afresh after an update would break a working Connection for no reason the person could see.

## Consequences

- The setup wizard switches on managed OAuth, lists the redirect addresses of Claude and ChatGPT, and allows clients on localhost and loopback. Claude's apps, ChatGPT and Claude Code are the clients the spec promises. Another hosted client works only once the person lists its redirect address.
- Praxis serves only the stateless 2026-07-28 protocol. There are no sessions and no HTTP+SSE.
- The address holds an opaque id, never the Context's name. It is not a secret: the Access login stands in front of it.
- Whatever signs in as the person through an address is that Connection. Praxis records the client registrations it has seen on each one. One address pasted into two clients puts both under one name.
- One client may hold two Connections to two Contexts. Praxis guards its own side only.
- Access lets a client's OAuth token through on every path of the hostname, not only `/mcp`, and signs the token it forwards for that client with an `oauth` claim, which a browser's lacks (Workers Logs, #137). The Worker lets a token with the claim reach only `/mcp`, so a Connection limited to reading, or to one Context, cannot reach the screen's tools as the person, and it refuses a token without the claim on `/mcp`. Cloudflare does not document the claim. If it is renamed, MCP is refused rather than the screen's tools opened to a client, and the Worker's `missing_on_mcp` log line shows it.
- On every call the Worker checks the Connection in the Deployment object, so ending one, or switching it to reading only, takes effect on the next call and does not depend on Access revoking a token.
- A Connection limited to reading is offered only the reading tools.
- A call to an ended Connection and a call to an address that never existed get the same refusal, which says to make a new Connection in Praxis.
- Making, renaming, switching and ending a Connection are the person's hand only, on the screen. They are never offered to the Agent or to an MCP caller.
- Retiring a Context ends its Connections, and bringing it back does not restore them.
- A Connection's name is kept after it ends, as the Author of what it made.
- Access registers clients by Dynamic Client Registration only, which the current MCP specification deprecates. Praxis depends on Access keeping up.
