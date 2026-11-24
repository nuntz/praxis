import type { Server, ServerWebSocket } from "bun";
import { ACCESS_TOKEN_HEADER } from "../src/access.ts";
import {
  fakeAccess,
  SOMEONE_ELSES_EMAIL,
  THE_PERSONS_EMAIL,
  THROUGH_OAUTH,
} from "../test/access-fake.ts";

// Praxis on this machine, behind a stand-in for Cloudflare Access: `wrangler dev` on the next
// port up, and in front of it what Access does for a Deployment. It signs every request in as the
// person with the fake's test key, publishes that key where Access publishes its keys, and sends
// a browser whose sign-in has lapsed to a login page on another origin, as Access does. The
// browser journeys run against it, and so does `bun run dev`.
//
//   bun scripts/access-stand-in.ts [--port 8787] [any other `wrangler dev` options]
//
// A lapsed sign-in is a cookie: while the browser carries SIGNED_OUT, nothing is let through. As
// Access does, the login page sends the browser back to the address it was asked for once signed in.
// Signed in with another Google address is a cookie too: while the browser carries ANOTHER_EMAIL,
// what is let through carries that address, as from an account the Deployment does not let in.
//
// Access's sign-in is a cookie too, so a request the browser sends without credentials, as it
// fetches a manifest unless told otherwise, is refused. The stand-in sets SIGNED_IN on what it
// lets through, and refuses a subresource a browser asks for without it; a navigation, or a client
// that is no browser, is signed in as before.

/** The cookie that stands for a lapsed Access sign-in. */
const SIGNED_OUT = "praxis-stand-in-signed-out";
/** The cookie that stands for Access's sign-in, which a browser sends only with credentials. */
const SIGNED_IN = "praxis-stand-in-signed-in";
/** The cookie that stands for a sign-in with a Google address other than the person's. */
const ANOTHER_EMAIL = "praxis-stand-in-another-email";

/** Whether the request carries the stand-in's cookie of that name. */
function carries(request: Request, cookie: string): boolean {
  return request.headers.get("cookie")?.includes(`${cookie}=yes`) ?? false;
}

/**
 * The token Access puts on a request it lets through: the person's, or another address's. A
 * request to MCP carries Access's OAuth claim, as from a client signed in through managed OAuth,
 * which every MCP caller is; nothing else does, as from a browser.
 */
function tokenFor(request: Request): Promise<string> {
  const throughOAuth = new URL(request.url).pathname.startsWith("/mcp") ? THROUGH_OAUTH : {};
  return carries(request, ANOTHER_EMAIL)
    ? access.sign(Date.now(), { ...throughOAuth, email: SOMEONE_ELSES_EMAIL })
    : access.sign(Date.now(), throughOAuth);
}

const options = process.argv.slice(2);
const portAt = options.indexOf("--port");
const port = portAt === -1 ? 8787 : Number(options[portAt + 1]);
const passed = portAt === -1 ? options : options.toSpliced(portAt, 2);
const workerPort = port + 1;

const origin = `http://localhost:${port}`;
// Access's login page is on the team's domain, never the Deployment's.
const loginOrigin = `http://127.0.0.1:${port}`;
const application = { teamDomain: origin, audience: "praxis-stand-in" };
const access = await fakeAccess(application);

const worker = Bun.spawn(
  [
    "bunx",
    "wrangler",
    "dev",
    "--port",
    String(workerPort),
    "--var",
    `ACCESS_TEAM_DOMAIN:${application.teamDomain}`,
    "--var",
    `ACCESS_AUD:${application.audience}`,
    "--var",
    `SIGN_IN_EMAIL:${THE_PERSONS_EMAIL}`,
    ...passed,
  ],
  { stdio: ["inherit", "inherit", "inherit"] },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    worker.kill();
    process.exit(0);
  });
}
worker.exited.then((code) => process.exit(code));

/** Access's login page, which signs the browser in and sends it back to the address it was at. */
function loginPage(back: string): string {
  const signIn = `${origin}/cdn-cgi/access/sign-in?redirect_url=${encodeURIComponent(back)}`;
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Sign in (stand-in for Access)</title>
<main><h1>Sign in</h1><p>A stand-in for Cloudflare Access's login page.</p>
<p><a href="${signIn}">Sign in as the person</a></p></main></html>`;
}

/** The address to go back to once signed in: one of the Deployment's own, or its first. */
function backTo(url: URL): string {
  const back = url.searchParams.get("redirect_url") ?? "/";
  return back.startsWith("/") && !back.startsWith("//") ? back : "/";
}

/**
 * A live channel through the stand-in: the browser's socket on one side, one to the Worker, with
 * Access's token on it, on the other. What the Worker sends before the browser's side is up waits.
 */
type Piped = { upstream: WebSocket; waiting: string[]; browser: ServerWebSocket<Piped> | null };

/** A close code to send on: one only a closing end may report, such as 1006, becomes `otherwise`. */
function sendable(code: number, otherwise: number): number {
  return code >= 1005 && code <= 1015 ? otherwise : code;
}

/** Bun's own WebSocket, which takes headers, as the DOM's typing of it does not say. */
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => WebSocket;

async function pipeLive(request: Request, url: URL, server: Server<Piped>) {
  const upstream = new BunWebSocket(`ws://localhost:${workerPort}${url.pathname}${url.search}`, {
    headers: { [ACCESS_TOKEN_HEADER]: await tokenFor(request) },
  });
  const piped: Piped = { upstream, waiting: [], browser: null };
  upstream.addEventListener("message", (event) => {
    if (piped.browser) piped.browser.send(String(event.data));
    else piped.waiting.push(String(event.data));
  });
  upstream.addEventListener("close", ({ code, reason }) => {
    piped.browser?.close(sendable(code, 1011), reason);
  });
  const opened = await new Promise<boolean>((resolve) => {
    upstream.addEventListener("open", () => resolve(true), { once: true });
    upstream.addEventListener("error", () => resolve(false), { once: true });
  });
  if (!opened) return new Response("The Worker opened no live channel.", { status: 502 });
  if (server.upgrade(request, { data: piped })) return undefined;
  upstream.close();
  return new Response("Not a WebSocket.", { status: 400 });
}

Bun.serve<Piped>({
  port,
  websocket: {
    open(browser) {
      browser.data.browser = browser;
      for (const message of browser.data.waiting.splice(0)) browser.send(message);
    },
    // Passed on as sent, so the Worker answers it as it would anything sent up the channel.
    message(browser, message) {
      browser.data.upstream.send(message);
    },
    close(browser, code, reason) {
      browser.data.upstream.close(sendable(code, 1000), reason);
    },
  },
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/cdn-cgi/access/certs") {
      return Response.json({ keys: await access.keySet.keys() });
    }
    if (url.pathname === "/cdn-cgi/access/login") {
      return new Response(loginPage(backTo(url)), { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/cdn-cgi/access/sign-in") {
      return new Response(null, {
        status: 302,
        headers: { location: backTo(url), "set-cookie": `${SIGNED_OUT}=; Path=/; Max-Age=0` },
      });
    }
    if (carries(request, SIGNED_OUT)) {
      const back = encodeURIComponent(url.pathname + url.search);
      return Response.redirect(`${loginOrigin}/cdn-cgi/access/login?redirect_url=${back}`, 302);
    }

    // A browser names what it fetches for; Node's fetch, as an MCP client uses, sends a mode only.
    const fetchedFor = request.headers.get("sec-fetch-dest");
    const subresource = fetchedFor !== null && fetchedFor !== "document";
    if (subresource && !carries(request, SIGNED_IN)) {
      // As Access answers a request that carries no sign-in.
      return Response.json(
        { error: "invalid_token" },
        {
          status: 401,
          headers: { "www-authenticate": 'Bearer realm="OAuth", error="invalid_token"' },
        },
      );
    }

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return pipeLive(request, url, server);
    }

    const headers = new Headers(request.headers);
    headers.set(ACCESS_TOKEN_HEADER, await tokenFor(request));
    headers.delete("host");
    // Bun's fetch decompresses a body but keeps its encoding header, which the browser would
    // then decode again, so the Worker is asked for none.
    headers.set("accept-encoding", "identity");
    try {
      const answer = await fetch(`http://localhost:${workerPort}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });
      const signedIn = new Response(answer.body, answer);
      signedIn.headers.append("set-cookie", `${SIGNED_IN}=yes; Path=/; HttpOnly; SameSite=Lax`);
      return signedIn;
    } catch {
      return new Response("The Worker is not up yet.", { status: 502 });
    }
  },
});
console.log(`Praxis, signed in through a stand-in for Access, at ${origin}`);
