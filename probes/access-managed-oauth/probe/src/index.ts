// Throwaway probe: a one-tool MCP Worker meant to sit behind Cloudflare Access
// with managed OAuth. It contains no OAuth code. It logs what each caller sends
// and reports the identity Access hands it.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

type Seen = Record<string, unknown>;

async function readIdentity(token: string): Promise<Seen> {
	const claims = decodeJwt(token);
	const iss = String(claims.iss ?? "");
	let verified: boolean | string = false;
	// Only trust keys from an Access team domain named by the token itself.
	if (/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(iss)) {
		try {
			await jwtVerify(token, createRemoteJWKSet(new URL(`${iss}/cdn-cgi/access/certs`)), {
				issuer: iss,
			});
			verified = true;
		} catch (e) {
			verified = `failed: ${(e as Error).message}`;
		}
	}
	return {
		signatureVerified: verified,
		email: claims.email,
		sub: claims.sub,
		type: claims.type,
		common_name: claims.common_name,
		aud: claims.aud,
		iss,
		oauth: claims.oauth,
		lifetimeSeconds: claims.exp && claims.iat ? claims.exp - claims.iat : undefined,
		otherClaims: Object.keys(claims).filter(
			(k) => !["email", "sub", "type", "common_name", "aud", "iss", "exp", "iat", "nbf"].includes(k),
		),
	};
}

function createServer() {
	const server = new McpServer({ name: "Praxis Access probe", version: "0.0.1" });
	const seen = getMcpAuthContext()?.props as Seen | undefined;
	server.registerTool(
		"whoami",
		{
			description: `Report who the probe Worker thinks is calling, and how the call arrived. This is connection "${seen?.connection ?? "none"}".`,
		},
		async () => ({ content: [{ type: "text", text: JSON.stringify(seen, null, 2) }] }),
	);
	return server;
}

export default {
	async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const h = request.headers;
		const token = h.get("Cf-Access-Jwt-Assertion");
		let rpc: unknown;
		if (request.method === "POST") {
			try {
				const body = await request.clone().json();
				rpc = Array.isArray(body) ? body.map((m) => m.method) : (body as { method?: string }).method;
			} catch {
				rpc = "unparseable";
			}
		}
		const call: Seen = {
			method: request.method,
			path: url.pathname,
			rpc,
			userAgent: h.get("user-agent"),
			network: (request as { cf?: { asOrganization?: string } }).cf?.asOrganization,
			mcpProtocolVersion: h.get("mcp-protocol-version"),
			mcpSessionId: h.get("mcp-session-id"),
			origin: h.get("origin"),
			authorizationScheme: h.get("authorization")?.split(" ")[0] ?? null,
			accessJwtPresent: Boolean(token),
			accessCookiePresent: /CF_Authorization=/.test(h.get("cookie") ?? ""),
		};

		if (!token) {
			console.log(JSON.stringify({ probe: "no-access-jwt", ...call }));
			return new Response("Probe: no Cf-Access-Jwt-Assertion. Access is not in front of this request.", {
				status: 401,
			});
		}

		let identity: Seen;
		try {
			identity = await readIdentity(token);
		} catch (e) {
			identity = { error: (e as Error).message };
		}
		let ctxAccess: unknown = "absent";
		try {
			const access = (ctx as { access?: { getIdentity?: () => Promise<unknown> } }).access;
			if (access?.getIdentity) ctxAccess = await access.getIdentity();
		} catch (e) {
			ctxAccess = `error: ${(e as Error).message}`;
		}
		const seen = { call, identity, ctxAccess };
		console.log(JSON.stringify({ probe: "request", ...seen }));

		if (identity.signatureVerified !== true) {
			return new Response("Probe: the Access token did not verify.", { status: 403 });
		}
		// A Connection's address: /mcp/<opaque id>. The bare /mcp is kept too.
		const match = /^\/mcp(?:\/([A-Za-z0-9_-]+))?$/.exec(url.pathname);
		if (!match) {
			return new Response(JSON.stringify(seen, null, 2), {
				headers: { "content-type": "application/json" },
			});
		}
		const connection = match[1] ?? null;
		const response = await createMcpHandler(createServer, {
			route: url.pathname,
			authContext: { props: { connection, ...seen } },
		})(
			request,
			env,
			ctx,
		);
		console.log(JSON.stringify({ probe: "response", rpc, status: response.status }));
		return response;
	},
};
