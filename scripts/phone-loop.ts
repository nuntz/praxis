import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ServerWebSocket } from "bun";

/**
 * A build of Praxis served to a real phone, with a heartbeat that says whether its screen drew and
 * whether it froze (docs/phone-pages.md). It builds a commit, or the checkout as it is, runs it
 * behind the stand-in for Access as `bun run dev` does, and puts a proxy in front on a port the
 * phone reaches. The proxy answers the reads given to it with what production answered, so the
 * screen draws the person's own data, and adds a script to the page that reports every 250 ms how
 * many of the counted elements are drawn. A page that stops reporting while shown has frozen.
 *
 *   bun scripts/phone-loop.ts [--commit REV] [--patch FILE] [--replay DIR] [--port 8787]
 *
 * One run serves one build: to bisect, stop it and run it again on the next commit.
 */

/** Where the page fetches the heartbeat from, and sends each beat to. */
export const HEARTBEAT = "/__phone-loop/alive";

/** How long a shown page may go without a beat before it counts as frozen. */
export const FROZEN_AFTER_MS = 2000;

/**
 * The heartbeat, a script of the page's own origin so the screen's CSP lets it run. Each load
 * names itself, beats at once and every 250 ms, and says when it is hidden or left, since a phone
 * stops a hidden page's timers and a page closed sends nothing more.
 */
export function heartbeatScript(counted: string): string {
  return `(() => {
  const load = Math.random().toString(36).slice(2, 8);
  const started = Date.now();
  let beat = 0;
  const send = (state) => {
    const build = [...document.scripts]
      .map((script) => script.src)
      .find((src) => src.includes("/assets/index-"))
      ?.split("/")
      .pop();
    const rows = document.querySelectorAll(${JSON.stringify(counted)}).length;
    navigator.sendBeacon("${HEARTBEAT}", JSON.stringify({ load, beat, ms: Date.now() - started, rows, build, state }));
    beat += 1;
  };
  send("shown");
  setInterval(() => send(document.hidden ? "hidden" : "shown"), 250);
  document.addEventListener("visibilitychange", () => send(document.hidden ? "hidden" : "shown"));
  addEventListener("pagehide", () => send("left"));
})();
`;
}

/** The page with the heartbeat added, run before the screen's own script. */
export function withHeartbeat(html: string): string {
  if (!html.includes("</head>")) return html;
  return html.replace("</head>", `<script src="${HEARTBEAT}.js"></script></head>`);
}

/**
 * The answer a read is given in place of the Deployment's, or null to pass it on: a Context's
 * tool given in `replays`, asked as the screen first asks it, with no input. A later page of a
 * list, asked with a cursor, is the local Deployment's own.
 */
export function replayed(
  method: string,
  pathname: string,
  input: string,
  replays: ReadonlyMap<string, string>,
): string | null {
  if (method !== "POST") return null;
  const tool = /^\/api\/contexts\/[^/]+\/tools\/([a-z_]+)$/.exec(pathname)?.[1];
  if (!tool || !replays.has(tool)) return null;
  const asked = input.trim() === "" ? {} : JSON.parse(input);
  return Object.keys(asked).length === 0 ? (replays.get(tool) ?? null) : null;
}

/** One beat, as the heartbeat sends it. */
export interface Beat {
  load: string;
  beat: number;
  ms: number;
  rows: number;
  build: string;
  state: "shown" | "hidden" | "left";
}

/**
 * The heartbeats of every load, told as lines a person or an agent reads: a load's first beat, each
 * change in what it counts, and its verdict once it stops: left, hidden, or frozen while shown.
 */
export class Pulse {
  private loads = new Map<string, { last: Beat; heardAt: number; told: boolean }>();

  /** The lines a beat heard at `now` tells. */
  heard(beat: Beat, now: number): string[] {
    const known = this.loads.get(beat.load);
    this.loads.set(beat.load, { last: beat, heardAt: now, told: false });
    const at = `load ${beat.load} ${beat.build} beat ${beat.beat} at ${beat.ms}ms`;
    if (!known) return [`${at}: started, ${beat.rows} counted`];
    if (beat.state === "left") return [`${at}: left, ${beat.rows} counted`];
    if (known.last.rows !== beat.rows) return [`${at}: ${beat.rows} counted`];
    return [];
  }

  /**
   * The verdicts due at `now`: each load shown and silent past FROZEN_AFTER_MS, once. A page
   * closed without its `pagehide` beat reaching here falls silent too, so the verdict says both;
   * a freeze shows as silence soon after the page drew, while the person still looks at it.
   */
  verdicts(now: number): string[] {
    const due: string[] = [];
    for (const [load, heard] of this.loads) {
      const { last } = heard;
      if (heard.told || last.state !== "shown" || now - heard.heardAt < FROZEN_AFTER_MS) continue;
      heard.told = true;
      due.push(
        `load ${load} ${last.build} FROZEN, or closed unsaid: silent after beat ${last.beat} at ${last.ms}ms, ${last.rows} counted`,
      );
    }
    return due;
  }
}

/** What a run serves, and where. */
interface Options {
  /** The commit to build, or null for the checkout as it is. */
  commit: string | null;
  patch: string | null;
  replays: Map<string, string>;
  /** Where the phone reaches the proxy, on loopback. */
  port: number;
  /** Where the stand-in for Access listens; the Worker takes the next port up. */
  workerPort: number;
  counted: string;
  /** The local Deployment's storage, kept from run to run so each build reads the same. */
  store: string;
}

const repo = resolve(import.meta.dir, "..");

function run(command: string, args: string[], cwd: string) {
  const done = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (done.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

/** The checkout to build: the repo as it is, or a worktree of its own at the commit, patched. */
function checkoutFor(options: Options): string {
  if (!options.commit) return repo;
  const at = join(tmpdir(), `praxis-phone-loop-${basename(repo)}`);
  if (!existsSync(at)) run("git", ["worktree", "add", "--detach", at, options.commit], repo);
  // What an earlier run patched is put back first, so each build is its commit and its patch only.
  run("git", ["reset", "--quiet", "--hard"], at);
  run("git", ["checkout", "--quiet", "--detach", options.commit], at);
  if (options.patch) run("git", ["apply", resolve(options.patch)], at);
  run("bun", ["install"], at);
  return at;
}

async function answered(url: string, within: number) {
  const until = Date.now() + within;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(500);
  }
  throw new Error(`${url} did not answer within ${within / 1000}s`);
}

/** The local Deployment's first Context, made if it has none, so the screen opens on one. */
async function ensureContext(origin: string) {
  const ask = (tool: string, input: unknown) =>
    fetch(`${origin}/api/deployment/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then((answer) => answer.json() as Promise<{ value: { items: unknown[] } }>);
  const { value } = await ask("list_contexts", {});
  if (value.items.length > 0) return;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await ask("create_context", { name: "Phone loop", time_zone: zone, accent: "blue" });
}

type Piped = { upstream: WebSocket; waiting: string[]; browser: ServerWebSocket<Piped> | null };

const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => WebSocket;

/** The proxy the phone reaches: replays, the heartbeat, and the rest passed to the stand-in. */
function serveProxy(options: Options) {
  const upstreamHost = `localhost:${options.workerPort}`;
  const pulse = new Pulse();
  const tell = (lines: string[]) => {
    for (const line of lines) console.log(`[phone] ${line}`);
  };
  setInterval(() => tell(pulse.verdicts(Date.now())), 500);

  Bun.serve<Piped>({
    hostname: "127.0.0.1",
    port: options.port,
    websocket: {
      open(browser) {
        browser.data.browser = browser;
        for (const message of browser.data.waiting.splice(0)) browser.send(message);
      },
      message(browser, message) {
        browser.data.upstream.send(message);
      },
      close(browser) {
        browser.data.upstream.close();
      },
    },
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === `${HEARTBEAT}.js`) {
        return new Response(heartbeatScript(options.counted), {
          headers: { "content-type": "text/javascript", "cache-control": "no-store" },
        });
      }
      if (url.pathname === HEARTBEAT) {
        tell(pulse.heard(JSON.parse(await request.text()) as Beat, Date.now()));
        return new Response(null, { status: 204 });
      }
      const input = request.method === "POST" ? await request.text() : "";
      const replay = replayed(request.method, url.pathname, input, options.replays);
      if (replay !== null) {
        return new Response(replay, { headers: { "content-type": "application/json" } });
      }
      // The stand-in answers its own host names only.
      const headers = new Headers(request.headers);
      headers.set("host", upstreamHost);
      if (request.headers.get("upgrade") === "websocket") {
        return pipeLive(request, url, upstreamHost, server);
      }
      // A page answered 304 from the phone's cache would come without the heartbeat.
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/assets/")) {
        headers.delete("if-none-match");
        headers.delete("if-modified-since");
      }
      const answer = await fetch(`http://${upstreamHost}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === "POST" ? input : null,
        redirect: "manual",
      });
      // fetch has decoded the body, so its encoding and length no longer hold.
      const back = new Headers(answer.headers);
      back.delete("content-encoding");
      back.delete("content-length");
      if (back.get("content-type")?.includes("text/html")) {
        return new Response(withHeartbeat(await answer.text()), {
          status: answer.status,
          headers: back,
        });
      }
      return new Response(answer.body, { status: answer.status, headers: back });
    },
  });
}

async function pipeLive(
  request: Request,
  url: URL,
  upstreamHost: string,
  server: Bun.Server<Piped>,
) {
  const upstream = new BunWebSocket(`ws://${upstreamHost}${url.pathname}${url.search}`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });
  const piped: Piped = { upstream, waiting: [], browser: null };
  upstream.addEventListener("message", (event) => {
    if (piped.browser) piped.browser.send(String(event.data));
    else piped.waiting.push(String(event.data));
  });
  upstream.addEventListener("close", () => piped.browser?.close());
  const opened = await new Promise<boolean>((done) => {
    upstream.addEventListener("open", () => done(true), { once: true });
    upstream.addEventListener("error", () => done(false), { once: true });
  });
  if (!opened) return new Response("The Worker opened no live channel.", { status: 502 });
  if (server.upgrade(request, { data: piped })) return undefined;
  upstream.close();
  return new Response("Not a WebSocket.", { status: 400 });
}

/** Each `<tool>.json` in the folder, as that tool's answer. */
function replaysIn(folder: string | undefined): Map<string, string> {
  if (!folder) return new Map();
  return new Map(
    readdirSync(folder)
      .filter((file) => file.endsWith(".json"))
      .map((file) => [file.slice(0, -".json".length), readFileSync(join(folder, file), "utf8")]),
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      commit: { type: "string" },
      patch: { type: "string" },
      replay: { type: "string" },
      port: { type: "string", default: "8787" },
      "worker-port": { type: "string", default: "8830" },
      count: { type: "string", default: ".attention-list li" },
      store: { type: "string", default: join(repo, ".wrangler/phone-loop") },
    },
  });
  if (values.patch && !values.commit) throw new Error("--patch is applied to a --commit");
  const options: Options = {
    commit: values.commit ?? null,
    patch: values.patch ?? null,
    replays: replaysIn(values.replay),
    port: Number(values.port),
    workerPort: Number(values["worker-port"]),
    counted: values.count,
    store: resolve(values.store),
  };
  const checkout = checkoutFor(options);
  run("bun", ["run", "build"], join(checkout, "apps/pwa"));
  mkdirSync(options.store, { recursive: true });
  const worker: ChildProcess = spawn(
    "bun",
    [
      "scripts/access-stand-in.ts",
      "--port",
      String(options.workerPort),
      "--persist-to",
      options.store,
    ],
    { cwd: join(checkout, "apps/worker"), stdio: ["ignore", "ignore", "inherit"] },
  );
  const stop = () => {
    worker.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await answered(`http://localhost:${options.workerPort}/`, 120_000);
  await ensureContext(`http://localhost:${options.workerPort}`);
  serveProxy(options);
  const built = spawnSync("git", ["log", "--oneline", "-1"], { cwd: checkout }).stdout.toString();
  const what = options.commit ? built.trim() : `the checkout as it is, on ${built.trim()}`;
  console.log(`[phone] serving ${what}${options.patch ? ", patched" : ""}`);
  console.log(
    `[phone] on 127.0.0.1:${options.port}, replaying ${[...options.replays.keys()].join(", ") || "nothing"}; counting ${options.counted}`,
  );
}
