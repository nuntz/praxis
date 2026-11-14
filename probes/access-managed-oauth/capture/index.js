// Throwaway: poses as an OAuth-protected MCP server whose registration endpoint
// echoes the request back as an error, so the redirect URIs a hosted client
// asks for can be read. It issues no tokens and serves no tools.
export default {
	async fetch(request) {
		const url = new URL(request.url);
		const o = url.origin;
		const json = (v, status = 200, headers = {}) =>
			new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
		if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
			return json({ resource: `${o}/mcp`, authorization_servers: [o] });
		}
		if (url.pathname.startsWith("/.well-known/oauth-authorization-server") || url.pathname.startsWith("/.well-known/openid-configuration")) {
			return json({
				issuer: o,
				authorization_endpoint: `${o}/authorize`,
				token_endpoint: `${o}/token`,
				registration_endpoint: `${o}/register`,
				response_types_supported: ["code"],
				grant_types_supported: ["authorization_code", "refresh_token"],
				token_endpoint_auth_methods_supported: ["none"],
				code_challenge_methods_supported: ["S256"],
			});
		}
		if (url.pathname === "/register") {
			const body = await request.text();
			console.log(JSON.stringify({ capture: "register", ua: request.headers.get("user-agent"), body }));
			return json({ error: "invalid_client_metadata", error_description: `CAPTURED ${body}` }, 400);
		}
		return json({ error: "invalid_token" }, 401, {
			"www-authenticate": `Bearer realm="OAuth", error="invalid_token", resource_metadata="${o}/.well-known/oauth-protected-resource/mcp"`,
		});
	},
};
