# Serving MCP from a Worker behind Access

Research for issue #4. Sources were read on 2026-11-14. This area changes quickly, so each section gives the date or version of what it relies on. This document lays out options and does not choose one.

## Short answer

- A Worker serves MCP as one HTTP endpoint (conventionally `/mcp`) that accepts POST: the Streamable HTTP transport. The older HTTP+SSE transport is deprecated in the spec and in Cloudflare's SDK.
- Every major hosted client (Claude's apps, ChatGPT) expects OAuth with discovery metadata. Static credentials only work from Claude Code, the Claude Messages API, and a limited beta in Claude's apps.
- Cloudflare offers three building blocks: Access "managed OAuth" (Access itself becomes the OAuth authorization server for a protected hostname), the `@cloudflare/workers-oauth-provider` library (the Worker is its own authorization server), and Access service tokens (a static machine credential).
- Hosted clients call from the vendor's cloud, not from the user's device. A plain Access-protected hostname answers them with a login redirect they cannot complete, so the MCP path needs either managed OAuth or its own carve-out from Access.
- The Worker learns the caller from one of two places: the Access JWT in `Cf-Access-Jwt-Assertion` (or `ctx.access`), or the `props` that its own OAuth provider stored when the grant was approved.

## 1. What the MCP specification requires now

The current revision is **2026-07-28**. It changed the transport and the authorization rules substantially from 2025-11-25 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).

### Transport

- Two standard transports exist: stdio and Streamable HTTP ([transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)).
- Streamable HTTP is a single endpoint that accepts POST. Each JSON-RPC request is its own POST, and the server answers with one JSON object or an SSE stream scoped to that request ([Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)).
- 2026-07-28 made the protocol stateless. It removed the `initialize` handshake, the `Mcp-Session-Id` header, the GET stream and stream resumption. Every request carries its protocol version and client capabilities in `_meta`, mirrored in the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers.
- Servers must validate the `Origin` header and should authenticate all connections.
- HTTP+SSE (the 2024-11-05 transport with separate SSE and POST endpoints) has been deprecated since 2025-03-26 and is now formally in the Deprecated state. New implementations should not adopt it.
- Older clients ("legacy", 2025-11-25 and earlier) still open with `initialize`. A server may serve both eras on one endpoint. A modern-only server fails legacy clients, which have no way to upgrade themselves ([versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)).

### Authorization

From the [authorization page](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) and [client registration page](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration):

- Authorization is optional. When used over HTTP it should follow the spec, which is a profile of OAuth 2.1.
- The MCP server is an OAuth resource server. It must serve Protected Resource Metadata (RFC 9728) and answer unauthenticated requests with `401` and a `WWW-Authenticate: Bearer resource_metadata="..."` header.
- The authorization server may be the same service or a separate one. It must publish RFC 8414 or OpenID Connect discovery metadata.
- Clients get a client ID in this priority order: pre-registered credentials, Client ID Metadata Documents (CIMD), Dynamic Client Registration (DCR), then asking the user.
- **DCR is deprecated as of 2026-07-28**, kept for backwards compatibility. CIMD is the recommended mechanism: the client ID is an HTTPS URL that the authorization server fetches.
- Clients must use PKCE and send the `resource` parameter (RFC 8707). Servers must check that a token was issued for them, and must not accept or pass through other tokens.
- Access tokens go in the `Authorization: Bearer` header on every request and must not appear in the URL query string.

## 2. What clients support

### Claude apps (claude.ai, Desktop, mobile, Cowork)

Source: [Authentication for connectors](https://claude.com/docs/connectors/building/authentication) and the help article [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) (shown as "Updated today" when read).

- Custom connectors are available on Free (one connector), Pro, Max, Team and Enterprise plans.
- Connections come **from Anthropic's cloud, not from the user's device**, including for Desktop and mobile. The published egress range is `160.79.104.0/21`. The server must be on the standard HTTPS port.
- Supported auth types: OAuth with DCR, OAuth with CIMD, OAuth with a user-supplied client ID and optional secret, and no authentication. A static request header (API key or bearer token) is **beta, for a limited set of organizations**, and is entered by an organization Owner.
- Claude chooses CIMD only when the authorization server metadata advertises both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`. Otherwise it falls back to DCR.
- A `401` is required to start sign-in. Claude uses only the first entry of `authorization_servers`. The metadata's `resource` must equal the server URL exactly as the user typed it.
- The redirect URI for all hosted surfaces is `https://claude.ai/api/mcp/auth_callback`.
- Claude always sends PKCE with S256. It refreshes tokens on a `401` and up to five minutes before expiry. OAuth endpoints get 10 seconds to respond.
- The `client_credentials` grant is not supported.
- Transports: the help article does not name them. The Claude Messages API connector documents "both Streamable HTTP and SSE" ([MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)).

### Claude Code

Source: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp).

- Connections come from the user's own machine.
- HTTP (Streamable HTTP) is the recommended remote transport. SSE is deprecated; recent versions try HTTP first and fall back to SSE.
- OAuth is supported through `/mcp` or `claude mcp login`, with RFC 9728 and RFC 8414 discovery, CIMD, DCR, and pre-configured credentials (`--client-id`, `--client-secret`, `--callback-port`).
- The redirect is a loopback URL on a per-session port, such as `http://localhost:3118/callback`. The authorization server must match `localhost` and `127.0.0.1` with the port ignored.
- Static headers are supported: `claude mcp add --transport http <name> <url> --header "Authorization: Bearer <token>"`, plus `headers` with environment variable expansion in `.mcp.json`, and a `headersHelper` command for generated headers.
- Non-interactive runs (`claude -p`, Agent SDK sessions) cannot run the OAuth flow; the sign-in must happen in an interactive session first.
- Connectors configured in claude.ai are also available inside Claude Code.

### Claude Messages API connector

Source: [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) (beta headers `mcp-client-2026-09-15` and `mcp-client-2025-11-20`).

- The server must be publicly reachable over HTTP; Streamable HTTP and SSE are both accepted.
- The caller passes an `authorization_token`, sent as a bearer token. The API does not run an OAuth flow itself.

### ChatGPT

Sources: OpenAI's [MCP guide](https://developers.openai.com/api/docs/mcp), [Authentication](https://developers.openai.com/plugins/build/auth) and [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) pages (undated).

- A custom MCP server is added from the Plugins screen with a public HTTPS URL including the `/mcp` path, described as supporting "streamable HTTP". The MCP guide still documents an `/sse/` endpoint as well.
- Auth is OAuth 2.1 following the MCP spec, or anonymous (`noauth`), or mixed per tool. CIMD is preferred, DCR is still supported, and a predefined client is possible.
- ChatGPT cannot present custom API keys or customer-provided mTLS certificates, and does not support the `client_credentials` grant.
- `code_challenge_methods_supported` must include `S256`. Redirect URIs are `https://chatgpt.com/connector/oauth/{callback_id}` or `https://chatgpt.com/connector_platform_oauth_redirect`, depending on whether the server returns the RFC 9207 `iss` parameter.
- Private servers need OpenAI's Secure MCP Tunnel; otherwise the endpoint must be public.
- Write actions require manual confirmation in the conversation.

### Summary table

| Client | Calls from | Streamable HTTP | OAuth (CIMD / DCR / own client) | Static header | No auth |
| - | - | - | - | - | - |
| Claude apps | Anthropic cloud | Yes | Yes / Yes / Yes | Beta, limited organizations | Yes |
| Claude Code | User's machine | Yes | Yes / Yes / Yes | Yes | Yes |
| Claude Messages API | Anthropic cloud | Yes | Caller supplies the token | Bearer token only | Yes |
| ChatGPT | OpenAI cloud | Yes | Yes / Yes / Yes | No | Yes |

## 3. What Cloudflare offers

### Serving the protocol

Source: [Transport](https://developers.cloudflare.com/agents/model-context-protocol/transport/) and [createMcpHandler reference](https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/), both updated 2026-10-27. Package versions when read: `agents` 0.33.0 (2026-11-03), `@cloudflare/workers-oauth-provider` 1.2.4 (2026-10-22).

- `createMcpHandler(factory, options)` from the `agents` package is the recommended way. It wraps an MCP SDK v2 server in a Worker `fetch` handler and serves Streamable HTTP only, at `/mcp` by default.
- It is stateless and needs no Durable Object, session or WebSocket. Application state lives in a Durable Object, D1, KV or R2, keyed by the authenticated user.
- It has a `legacy` option (default `"stateless"`, or `"reject"`) for clients on older protocol revisions. In that lane each POST builds a new server, GET and DELETE return `405`, and server-pushed requests fail.
- It does not authenticate anything itself. Identity is passed in through the `authContext` option or arrives from `OAuthResourceServer`; tools read it with `getMcpAuthContext()`.
- The `McpAgent` class (Durable Object per session, with an SSE endpoint) is now documented as deprecated.

### Workers OAuth Provider

Source: [Authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/) (updated 2026-10-27) and the [library README](https://github.com/cloudflare/workers-oauth-provider).

- The library makes a Worker an OAuth 2.1 authorization server. It serves discovery metadata, client registration and the token endpoint. The `/authorize` page is the application's own code.
- The recommended shape splits two roles: `OAuthAuthorizationServer` and `OAuthResourceServer`, joined by a Service Binding. The older single-Worker `OAuthProvider` remains fully supported.
- It supports CIMD (needs the `global_fetch_strictly_public` compatibility flag), DCR, pre-registered clients, PKCE, RFC 8707, RFC 9728, RFC 8414, token revocation and token exchange.
- Grants and tokens live in a KV namespace. Tokens, codes and secrets are stored as hashes.
- `completeAuthorization()` stores `props` with the grant. They are encrypted and delivered to the MCP handler as `ctx.props` on every request.
- Required scopes are advertised but not enforced; the handler must check `ctx.auth.scope`.
- User sign-in at `/authorize` can be delegated upstream: to Access, to GitHub or Google, or to Stytch, Auth0, WorkOS or Descope.

### Access managed OAuth

Source: [Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) (updated 2026-11-03) and the [changelog entry of 2026-03-20](https://developers.cloudflare.com/changelog/post/2026-03-20-managed-oauth/).

- Managed OAuth turns Access into an OAuth 2.0 authorization server for a self-hosted Access application, an MCP server application or an MCP server portal. It is opt-in for self-hosted applications.
- Non-browser clients get a `401` with a `WWW-Authenticate` header instead of the `302` login redirect. Discovery metadata is served at `https://<app-domain>/.well-known/oauth-authorization-server`.
- The client runs an authorization code flow; the user logs in through the Access identity provider in a browser. Access applies the same policies as for a browser login and re-evaluates them on each token refresh.
- The page documents DCR, with settings for allowed redirect URIs and for localhost and loopback clients. Non-loopback redirect URIs, such as a hosted client's callback, must be listed.
- The access token is opaque. Its default lifetime is 15 minutes; a separate grant session duration controls the refresh token.
- Cloudflare resolves the token and sends the origin the usual signed `Cf-Access-Jwt-Assertion` header, so the Worker sees the same thing as for a browser request.
- Cloudflare warns not to enable it when the application runs its own OAuth server and relies on its own `WWW-Authenticate` headers, because managed OAuth replaces the `401` behaviour.
- Cloudflare's demo [`remote-mcp-cf-access-self-hosted`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access-self-hosted) (last changed 2026-10-21) shows an MCP Worker behind a self-hosted Access application that validates the Access JWT with `jose` and contains no OAuth code.

### Access for SaaS as an OIDC identity provider

Source: [Secure MCP servers](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/) (updated 2026-11-02) and the demo [`remote-mcp-cf-access`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access).

- The Worker runs its own OAuth provider toward MCP clients and uses an Access for SaaS OIDC application as the upstream login.
- Setup creates an OIDC SaaS application with the Worker's `/callback` as redirect URL, then stores the client ID, client secret and the token, authorization and key endpoints as Worker secrets.
- The hostname is not behind a self-hosted Access application in this pattern; Access is only the identity provider.

### Service tokens

Source: [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) (updated 2026-11-11) and [Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) (updated 2026-06-25).

- A client sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. The application needs a policy with the Service Auth action.
- A self-hosted application can instead read both values as JSON from a single header such as `Authorization` (`read_service_tokens_from_header`).
- Tokens expire after the duration chosen at creation and can be rotated with a grace period.
- The JWT the origin receives carries `common_name` (the token's client ID) and an empty `sub`. It has no `email`. It identifies a machine credential, not a person.

### MCP server portals

Source: [MCP server portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/) (updated 2026-11-05).

- A portal puts several MCP servers behind one Access-protected endpoint with managed OAuth on by default. Service tokens work for machine access.
- It is built for organizations curating many servers. Upstream tool calls time out after 60 seconds.

## 4. Coexisting with Access on the same hostname

- By default Access answers an unauthenticated request with a `302` to a login page. Hosted MCP clients cannot complete that, and they call from the vendor's network, so no Access cookie or device client is present.
- Access applications can be scoped to paths. When several rules share a root path, the more specific one wins and does not inherit from its parent ([Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), updated 2026-04-17).
- A Bypass policy disables Access enforcement for matching traffic. Bypassed requests are not logged and get no Access controls ([Policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), updated 2026-11-02).
- Protecting a Worker from the Worker's own Access tab covers every domain of that Worker. Protecting only part of the traffic needs a self-hosted application for a hostname or path ([Workers and Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), updated 2026-11-02).
- So there are three ways for the MCP endpoint to live next to an Access-protected web app:
  1. Keep it behind the same Access application and enable managed OAuth.
  2. Keep it on the same hostname and give the MCP path and the OAuth and `/.well-known` paths their own path-scoped application with a Bypass policy, with the Worker enforcing its own tokens there.
  3. Put it on a separate hostname that Access does not protect.
- With option 2 or 3 the OAuth discovery documents and the token and registration endpoints must also be reachable without Access, because clients fetch them before they hold any credential.

## 5. How the Worker learns who is calling

- **Behind Access (browser, managed OAuth, or service token).** Access adds a signed JWT in `Cf-Access-Jwt-Assertion`. The Worker verifies it against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checking issuer and the application's AUD tag. Signing keys rotate every six weeks by default ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), updated 2026-11-02).
- A user JWT has `email`, `sub` and `identity_nonce`. A service-token JWT has `common_name` and an empty `sub`.
- Workers also expose `ctx.access` with `getIdentity()`, with no JWT parsing in application code. It is undefined when Access did not authenticate the request. It is not propagated over Service Bindings or RPC, and the Static Assets router does not pass it to the user Worker.
- **Own OAuth provider.** The Worker decides the identity once, at `/authorize`, and stores it as `props`. Every later MCP request arrives with those `props` already decrypted. Identity at `/authorize` comes from whatever login that page uses.
- **Static bearer token checked by the Worker.** The token proves possession only. For a one-person deployment the caller is "the owner" by construction, and separate tokens per client are the only way to tell clients apart.
- With CIMD or DCR, the client's own identity (which app is calling) is the `client_id` on the grant. The spec's `clientInfo` in `_meta` is self-reported and is not authentication.

## 6. The realistic options

### Option A: Access in front of everything, with managed OAuth

The web app and `/mcp` share one self-hosted Access application. Managed OAuth is switched on. The Worker validates the Access JWT on every request, for browsers and MCP clients alike.

- For: no OAuth code or token storage in the Worker. One identity path and one policy for web and MCP. Access re-checks policy on each refresh. Cloudflare publishes a matching demo.
- Against: sign-in for every MCP client depends on how Access's authorization server behaves, which Praxis cannot change. The documentation covers DCR, which the MCP spec now deprecates, and does not mention CIMD. Each hosted client's redirect URI has to be allow-listed. Compatibility with Claude's apps and ChatGPT is not documented by Cloudflare (see section 7).
- Depends on: the deployer having a Zero Trust organization with an identity provider or one-time PIN.

### Option B: the Worker is its own OAuth authorization server

The Worker uses `workers-oauth-provider`. The MCP endpoint, the OAuth endpoints and the `/.well-known` documents sit outside Access enforcement (path-scoped Bypass, or a separate hostname). The web app stays behind Access. The sub-variants differ in how `/authorize` identifies the person:

- **B1: Access for SaaS as the upstream OIDC login.** Cloudflare's documented pattern and demo. Identity still comes from Access policies. It needs a second Access application (SaaS, OIDC) and its client secret stored in the Worker.
- **B2: leave `/authorize` behind the existing self-hosted Access application** and read the Access JWT there. This follows from the path rules above but is not a pattern Cloudflare documents, so it is an inference to be tested.
- **B3: another identity provider** (GitHub, Google, and so on), independent of Access.

- For: Praxis controls the OAuth behaviour and can track the spec directly (CIMD, pre-registered clients, the RFC 9207 `iss` parameter, consent page). The library supports everything Claude and ChatGPT ask for. The grant records which client was authorized.
- Against: more moving parts for each deployer: a KV namespace, possibly a second Worker and Service Binding, a consent page, and an Access carve-out that must be exactly right. Praxis becomes responsible for an authorization server on the public internet. Bypassed paths lose Access logging and controls.

### Option C: a static credential

Either an Access service token (the MCP path keeps Access, with a Service Auth policy) or a bearer token that the Worker checks itself on a bypassed path.

- For: by far the least machinery. Works today from Claude Code (`--header`) and from the Claude Messages API (`authorization_token`, bearer form only).
- Against: ChatGPT cannot send static keys. In Claude's apps the static header is a limited beta. A service token normally needs two custom headers, or a JSON value in one header, which constrains clients further. The credential is long-lived and carries no user identity. Tokens in the URL are prohibited by the spec.

### Option D: an MCP server portal in front of the Worker

Access's portal product provides the OAuth front door and the Worker sits behind it as an upstream server.

- For: managed OAuth by default and central policy.
- Against: aimed at organizations aggregating many servers. It adds a hop, a 60-second tool timeout and another product to configure for a single-person deployment.

### Combinations

The options are not exclusive. OAuth (A or B) for hosted clients and a static credential (C) for scripts and headless agents can coexist, at the cost of two authentication paths to maintain. A and B cannot share one Access application, because managed OAuth replaces the `401` behaviour that the Worker's own provider relies on.

### Facts a later decision depends on

- Which clients must work on day one. ChatGPT and Claude's apps rule out a static credential as the only scheme.
- Whether the MCP endpoint must serve legacy (pre-2026-07-28) clients. `createMcpHandler` does this statelessly by default.
- How much setup each self-hoster can be asked to do in the Zero Trust dashboard, since every option needs some.
- Whether the web app and MCP share a hostname. A separate hostname removes the path carve-out but adds DNS and a second route.
- Whether Praxis needs to know which client is calling, or only that the owner approved it.

## 7. Not verified

- **Whether Claude's apps and ChatGPT complete sign-in against Access managed OAuth.** Cloudflare's page names neither. It documents `/.well-known/oauth-authorization-server` on the application domain and says the endpoint conforms to RFC 8414 and RFC 9728, but does not state that `/.well-known/oauth-protected-resource` is served or what the `401` header contains. Claude requires a `resource_metadata` pointer or that well-known path. This needs a live test.
- **Whether Access managed OAuth supports CIMD or pre-registered clients.** Only DCR is documented.
- **How Access decides a request is from a non-browser client** when choosing between `401` and `302`.
- **Whether `ctx.access` verifies the JWT signature itself.** The page says no parsing is required but does not say so explicitly, and does not describe what it returns for service tokens.
- **Which protocol revision each client currently speaks** (2026-07-28 or a legacy one). No vendor page read here states it. Claude's and OpenAI's documentation still link to the 2025-11-25 revision in places.
- **Which transports Claude's custom connectors accept.** The help article does not name them; Streamable HTTP and SSE are documented only for the Messages API connector and for Claude Code.
- **ChatGPT plan availability and limits.** OpenAI's help article returned an error when fetched. A search summary of it said full custom MCP support is for Business, Enterprise and Edu on the web, with Pro limited to read-only tools; this was not confirmed from the page.
- **Zero Trust plan requirements and pricing** for Access, managed OAuth and service tokens. None of the pages read state a plan tier.
- **Variant B2** (consent page behind the self-hosted Access application) is derived from the documented path rules, not from a documented example.
- Nothing here was tested against a running deployment.
