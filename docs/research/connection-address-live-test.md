# Live test: a Connection's address and Claude Code against Access managed OAuth

Tested 2026-11-14 against the throwaway probe Worker from the earlier live test (`access-managed-oauth-live-test.md`), redeployed on a `workers.dev` hostname behind a Cloudflare Access application with managed OAuth switched on. The probe now serves MCP at `/mcp` and at any `/mcp/<id>`, and its tool reports which id it was called through. Sources are in `probes/access-managed-oauth/probe/`. Account-specific names are replaced with `<team>` and `<probe-host>`, and registration ids with letters.

## Result

A path beneath `/mcp` works in every promised client, two such addresses sit side by side in one client, and Claude Code signs in on a random localhost port.

| | Claude | ChatGPT (web) | Claude Code 2.1.325 |
|---|---|---|---|
| `/mcp/abc123` | tool call 200 | tool call 200 | tool call 200 |
| `/mcp/xyz789` as a second connector | accepted, tool call 200 | accepted, tool call 200 | not tried |
| Sign-in for the second connector | asked again | asked again | |
| Registration | one id per connector | one id per connector | one id |
| Redirect URI | `https://claude.ai/api/mcp/auth_callback` | `https://chatgpt.com/connector/oauth/<id>`, the same `<id>` for both connectors | `http://localhost:52720/callback` |
| User agent | `Claude-User` | `openai-mcp/1.0.0` | `claude-code/2.1.325 (cli)` |
| Calling network | Anthropic | Microsoft | the person's own |
| Protocol revision | 2026-07-28 | 2026-07-28 | 2026-07-28 |

## What Access serves for a path beneath `/mcp`

- A non-browser `POST` to `/mcp/abc123` gets `401` with `WWW-Authenticate: Bearer realm="OAuth", error="invalid_token", ..., resource_metadata="https://<probe-host>/.well-known/cloudflare-access-protected-resource/mcp/abc123"`. The challenge follows the request path, whatever it is.
- `https://<probe-host>/.well-known/oauth-protected-resource/mcp/abc123` is served and names `https://<probe-host>/mcp/abc123` as the resource. Each address is its own protected resource, with the one team domain as authorization server.
- `https://<probe-host>/.well-known/oauth-authorization-server` is served at the root only. The same path with `/mcp/abc123` appended is a `404`. No client needed it.
- With managed OAuth off, the same requests get a `302` to the Access login and the resource document lists `cloudflared` only, as in the earlier test.

## Loopback clients

With "Allow localhost clients" and the loopback toggle on, Dynamic Client Registration by hand returned:

| Redirect URI | Result |
|---|---|
| `http://localhost:54321/callback` | `201` |
| `http://127.0.0.1:41877/callback` | `201` |
| `http://localhost/callback` | `201` |
| `https://example.com/cb` | `400 invalid_client_metadata: redirect_uri is not allowed by the account configuration` |

Any port is accepted, and the toggles do not loosen the allow-list for hosted addresses. Claude Code registered with `http://localhost:52720/callback` and completed sign-in in the browser.

## What the Worker sees

On every call, on both paths and from all three clients:

- The same verified Access token as before: the same `sub` and `email` as a browser session of the person, `type` `app`, one `aud` for the whole Access application.
- Nothing in the token names the path or the resource. The request path is the only thing that tells the Worker which Connection is calling. A token obtained through one address was not tried against the other, but nothing in it would stop that.
- The `oauth` claim carries the registration id and redirect URI. For Claude Code that is `{ "client_id": "<id>", "client_redirect_uri": "http://localhost:52720/callback" }`, so a loopback redirect marks a client on the person's machine.
- No `Authorization` header, no Access cookie, no `Origin`, no `Mcp-Session-Id`.

Clients sent `server/discover`, `tools/list` and `tools/call`. Claude also sent `subscriptions/listen` on each connector; the stateless handler answered `200`.

## Registration ids

| Event | Registration id |
|---|---|
| Claude, connector for `/mcp/abc123` | A |
| Claude, connector for `/mcp/xyz789` | B |
| Claude, `/mcp/abc123` disconnected and reconnected | C, a new one |
| ChatGPT, connector for `/mcp/abc123` | D |
| ChatGPT, connector for `/mcp/xyz789` | E |
| Claude Code, first sign-in | F |
| Claude Code, restarted | F, with the same callback port and no new sign-in |

- A hosted client registers once per connector, not once per client. Two Connections in one client are two registrations.
- Claude registers afresh on a reconnect. A registration id is not a lasting name for a client.
- Claude Code keeps its registration and its port across a restart.
- Access keeps every registration. Nothing was removed when a connector was.

## Token refresh

- Claude kept calling after its first 15-minute token expired, with no new sign-in. The refreshed token kept its original `iat` (apparent lifetime 1753 seconds). This was untested in the earlier run.
- Claude Code did the same across a restart (1594 seconds).

## Not tested

- Disconnecting and reconnecting a connector in ChatGPT.
- An app update in any client.
- A second address in Claude Code.
- A token obtained through one address presented at the other.
- A custom domain, and revoking a client or a grant from the Zero Trust dashboard.
