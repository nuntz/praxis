# Live test: hosted MCP clients against Access managed OAuth

Tested 2026-11-14 against a throwaway one-tool MCP Worker on a `workers.dev` hostname, behind a Cloudflare Access application with managed OAuth switched on. The Worker contains no OAuth code. Sources are in `probes/access-managed-oauth/`. Account-specific names are replaced with `<team>` and `<probe-host>`.

## Result

Both clients complete sign-in and call the tool.

| | Claude Desktop | ChatGPT (web) |
|---|---|---|
| Discovery | Detected OAuth and DCR on its own | Detected OAuth endpoints and DCR on its own |
| Registration | DCR, succeeded | DCR, succeeded only once its redirect URI was allow-listed |
| Sign-in | Completed through the Access login | Completed through the Access login |
| Tool call | 200 | 200 |
| User agent | `Claude-User` | `openai-mcp/1.0.0` |
| Calling network | Anthropic | Microsoft |
| Protocol revision | 2026-07-28 | 2026-07-28 |
| Redirect URI | `https://claude.ai/api/mcp/auth_callback` | `https://chatgpt.com/connector/oauth/<id>` |

## What Access serves

With Access in front and managed OAuth **off**:

- Every unauthenticated request gets a `302` to the Access login page, including a JSON `POST /mcp` and the standard OAuth well-known paths.
- The `302` carries `WWW-Authenticate: Cloudflare-Access resource_metadata="https://<probe-host>/.well-known/cloudflare-access-protected-resource/mcp"`. That document lists `cloudflared` as the only authentication method.
- `https://<team>.cloudflareaccess.com/.well-known/oauth-authorization-server` already exists, without a registration endpoint.

With managed OAuth **on**:

- A non-browser request to `/mcp` gets `401` with `WWW-Authenticate: Bearer realm="OAuth", error="invalid_token", ..., resource_metadata="https://<probe-host>/.well-known/cloudflare-access-protected-resource/mcp"`. A browser request still gets the `302`.
- `https://<probe-host>/.well-known/oauth-protected-resource` and `.../oauth-protected-resource/mcp` are served and name `https://<team>.cloudflareaccess.com` as the authorization server.
- `https://<probe-host>/.well-known/oauth-authorization-server` is served. Endpoints are on the team domain under `/cdn-cgi/access/oauth/` (`authorization`, `token`, `revoke`, `registration`). PKCE `S256`. Token endpoint auth methods `client_secret_basic`, `client_secret_post`, `none`.
- No CIMD support is advertised. ChatGPT's form says so explicitly: "CIMD is unavailable because the server did not advertise CIMD support."
- No scopes and no OIDC configuration are advertised.

## Registration and redirect URIs

- Access refuses a DCR request whose redirect URI is not on the application's allow-list: `400 invalid_client_metadata: redirect_uri is not allowed by the account configuration`.
- Claude registers with `https://claude.ai/api/mcp/auth_callback`.
- ChatGPT registers with `https://chatgpt.com/connector/oauth/<id>`. The id is not predictable: two attempts in one form session used the same id, and the connector that was finally created used a different one. The older `https://chatgpt.com/connector_platform_oauth_redirect` is not what it sends.
- The allow-list accepts a wildcard. With `https://chatgpt.com/connector/oauth/*` listed, a registration with an arbitrary id under that path returned `201`.
- ChatGPT reports a refused registration only as "Some app settings were rejected". The real error is in the response of its `connectors/mcp` request.
- ChatGPT ignores an edited Registration URL in its advanced settings and registers at the discovered one.

## What the Worker sees

For both clients, on every MCP request:

- `Cf-Access-Jwt-Assertion` is present and its signature verifies against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
- The `Authorization` header is absent. Access consumes the bearer token.
- No Access cookie, no `Origin`, no `Mcp-Session-Id`.
- The token's `email` and `sub` are the same as for a browser session of the same person. `type` is `app`.
- The token's lifetime is about 15 minutes (906 to 908 seconds), against 24 hours for the browser session.
- The token carries an `oauth` claim that a browser token lacks: `{ "client_id": "<DCR client id>", "client_redirect_uri": "<the client's redirect URI>" }`. This tells clients apart per registration, and the redirect URI's host names the vendor.
- `ctx.access.getIdentity()` is populated: email, name, user id, identity provider, country, IP, device posture. It agrees with the token.

Each client sent `server/discover`, then `tools/list`, then `tools/call`.

## Token refresh

- ChatGPT called the tool again 17 minutes after sign-in, after its first access token had expired. The call succeeded with no new sign-in.
- The token the Worker saw then kept the original `iat` and had a later `exp`, so its apparent lifetime was 1901 seconds. A Worker must not assume `exp - iat` is 15 minutes.
- Claude Desktop was not called again after its first token expired.

## Setup the deployer had to do

1. Enable Access on the Worker. In the Worker's own Access dialog the scope defaults to **Previews only** and has to be changed to **All traffic**.
2. Give the policy an email rule. The dialog's default rule was an email-domain rule.
3. Switch on managed OAuth in the Access application in the Zero Trust dashboard. The Worker's dialog has no such switch.
4. Allow-list `https://claude.ai/api/mcp/auth_callback` and `https://chatgpt.com/connector/oauth/*`.

## Not tested

- Token refresh in Claude Desktop after the 15-minute access token expires. It worked in ChatGPT.
- Claude on the web and on mobile, and ChatGPT's mobile and desktop apps.
- A custom domain. The test used `workers.dev`.
- A client that is not on the allow-list by default, such as one with a loopback redirect.
- Revoking a client or a grant from the Zero Trust dashboard.
