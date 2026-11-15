// PROTOTYPE. Throwaway probe: does a Call work as ADR 0021 decided it?
// The browser sends its WebRTC offer here; the Durable Object creates the GPT-Live session,
// attaches to the provider's side channel, and stands in for a Run on each handover.
// No error handling beyond what keeps it runnable. The only state is a log table named to be wiped.

import { DurableObject } from "cloudflare:workers";
import { PAGE } from "./page";

interface Env {
  CALL: DurableObjectNamespace<CallProbe>;
  OPENAI_API_KEY: string;
  PROBE_KEY: string;
  ANTHROPIC_API_KEY?: string;
}

const LIVE = "api.openai.com/v1/live/sessions";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!env.PROBE_KEY || url.searchParams.get("k") !== env.PROBE_KEY) {
      return new Response("no", { status: 403 });
    }
    if (url.pathname === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/slow-stream") return slowStream(url.searchParams.get("text") ?? "");
    return env.CALL.get(env.CALL.idFromName("call")).fetch(req);
  },
};

// A streamed body, a word every 60ms, so the object has a streaming subrequest to drain
// while the side channel is open (the shape reported in cloudflare/workerd#6774).
function slowStream(text: string): Response {
  const words = text.split(" ");
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(c) {
      for (const w of words) {
        c.enqueue(enc.encode(`${w} `));
        await sleep(60);
      }
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

const canned = (request: string) =>
  `Done. I recorded that in your Journal and made a Task from it, "Call the plumber about the boiler", due Thursday the 19th. ` +
  `I also moved "Renew passport" to Monday the 23rd. What I was given was: ${request}`;

export class CallProbe extends DurableObject<Env> {
  boot = crypto.randomUUID().slice(0, 8);
  ws?: WebSocket;
  sessionId?: string;
  sessionOver = true;
  origin = "";
  mode = "stream";
  settleMs = 0;
  heard = "";
  lastRunEnd = 0;
  seen = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS prototype_wipe_me_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, boot TEXT, kind TEXT, body TEXT)",
    );
    // A new boot id in the log while a Call is open means the object was evicted or restarted.
    this.log("object.boot", {});
  }

  log(kind: string, body: unknown) {
    this.ctx.storage.sql.exec(
      "INSERT INTO prototype_wipe_me_log (at, boot, kind, body) VALUES (?, ?, ?, ?)",
      Date.now(),
      this.boot,
      kind,
      JSON.stringify(body),
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/state") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const rows = this.ctx.storage.sql
        .exec("SELECT id, at, boot, kind, body FROM prototype_wipe_me_log WHERE id > ? ORDER BY id LIMIT 2000", since)
        .toArray();
      return Response.json({
        now: Date.now(),
        boot: this.boot,
        sessionId: this.sessionId,
        sessionOver: this.sessionOver,
        sidebandOpen: this.ws?.readyState === 1,
        hasAnthropicKey: !!this.env.ANTHROPIC_API_KEY,
        rows,
      });
    }

    if (path === "/api/wipe") {
      this.ctx.storage.sql.exec("DELETE FROM prototype_wipe_me_log");
      return Response.json({ ok: true });
    }

    if (path === "/api/close") {
      // Ending from the object, over the side channel.
      this.send({ type: "session.close", event_id: `close_${Date.now()}` });
      return Response.json({ ok: true });
    }

    if (path === "/api/session") {
      const { sdp, mode, settleMs, instructions } = (await req.json()) as {
        sdp: string;
        mode: string;
        settleMs: number;
        instructions: string;
      };
      this.origin = url.origin;
      this.mode = mode;
      this.settleMs = settleMs || 0;
      this.heard = "";
      this.seen.clear();
      try {
        this.ws?.close(1000);
      } catch {}

      const started = Date.now();
      const r = await fetch(`https://${LIVE}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          session: { model: "gpt-live-1", instructions, delegation: { type: "client" } },
          transport: { type: "webrtc", sdp },
        }),
      });
      const text = await r.text();
      if (!r.ok) {
        this.log("session.create.failed", { status: r.status, body: text.slice(0, 2000) });
        return new Response(text, { status: 502 });
      }
      const created = JSON.parse(text);
      this.sessionId = created.session.id;
      this.sessionOver = false;
      const { transport, ...rest } = created;
      this.log("session.created", { ms: Date.now() - started, mode, settleMs: this.settleMs, response: rest });
      this.ctx.waitUntil(this.attach());
      return Response.json(created);
    }

    return new Response("not found", { status: 404 });
  }

  // The first unproven fact: an outgoing WebSocket from a Durable Object carrying an Authorization header.
  async attach(attempt = 1): Promise<void> {
    for (const scheme of ["https", "wss"]) {
      const started = Date.now();
      try {
        const r = await fetch(`${scheme}://${LIVE}/${this.sessionId}/attach`, {
          headers: { Upgrade: "websocket", Authorization: `Bearer ${this.env.OPENAI_API_KEY}` },
        });
        if (r.webSocket) {
          const ws = r.webSocket;
          ws.accept();
          this.ws = ws;
          this.log("sideband.open", { scheme, attempt, ms: Date.now() - started });
          ws.addEventListener("message", (e) => this.ctx.waitUntil(this.onEvent(e.data as string)));
          ws.addEventListener("close", (e) => this.onClose(ws, e.code, e.reason));
          ws.addEventListener("error", (e) => this.log("sideband.error", { message: (e as ErrorEvent).message }));
          return;
        }
        this.log("sideband.refused", { scheme, attempt, status: r.status, body: (await r.text()).slice(0, 500) });
      } catch (e) {
        this.log("sideband.threw", { scheme, attempt, error: String(e) });
      }
    }
    if (attempt < 5 && !this.sessionOver) {
      await sleep(1000);
      return this.attach(attempt + 1);
    }
  }

  onClose(ws: WebSocket, code: number, reason: string) {
    this.log("sideband.close", {
      code,
      reason,
      sessionOver: this.sessionOver,
      msSinceLastRunEnd: this.lastRunEnd ? Date.now() - this.lastRunEnd : null,
    });
    if (this.ws === ws) this.ws = undefined;
    // Dropped while the Call is still on: can the object simply attach again?
    if (!this.sessionOver) this.ctx.waitUntil(this.attach());
  }

  send(event: Record<string, unknown>) {
    if (this.ws?.readyState !== 1) {
      this.log("sent.failed", { reason: "side channel not open", event });
      return;
    }
    this.ws.send(JSON.stringify(event));
    this.log("sent", event);
  }

  async onEvent(raw: string) {
    const ev = JSON.parse(raw);
    // Attaching replays the last three seconds, so the same event can arrive twice.
    if (ev.event_id) {
      if (this.seen.has(ev.event_id)) return;
      this.seen.add(ev.event_id);
    }
    this.log(`in:${ev.type}`, ev);

    if (ev.type === "session.input_transcript.delta") this.heard += ev.delta;
    if (ev.type === "session.closed") this.sessionOver = true;

    if (ev.type === "session.delegation.created" && ev.delegation?.target === "client") {
      // The handover carries no words: the request is rebuilt from the transcript heard since the last one.
      if (this.settleMs) await sleep(this.settleMs);
      const request = this.heard.trim();
      this.heard = "";
      const started = Date.now();
      this.log("run.start", { mode: this.mode, request });
      let answer: string;
      try {
        answer = await this.run(request);
      } catch (e) {
        this.log("run.failed", { error: String(e) });
        answer = "That did not work. Something failed on my side and nothing was changed.";
      }
      this.lastRunEnd = Date.now();
      this.log("run.end", { ms: this.lastRunEnd - started, answer });
      this.send({
        type: "session.commentary.append",
        event_id: `result_${started}`,
        delegation_id: ev.delegation.id,
        content: answer,
      });
    }
  }

  // The stand-in for a Run.
  async run(request: string): Promise<string> {
    if (this.mode === "plain") return canned(request);

    if (this.mode === "stream") {
      const r = await fetch(
        `${this.origin}/slow-stream?k=${encodeURIComponent(this.env.PROBE_KEY)}&text=${encodeURIComponent(canned(request))}`,
      );
      if (!r.ok || !r.body) throw new Error(`slow-stream ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let out = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += dec.decode(value, { stream: true });
      }
      return out.trim();
    }

    // mode "anthropic": a real streamed model call, as a Run would make.
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 300,
        stream: true,
        system:
          "You are being heard, not read. Answer in one or two short sentences. You have no tools in this trial: " +
          "if asked to record or change something, pretend you did and say exactly what you changed, with a made-up but specific date. " +
          "The request is a speech transcript and may hold mistakes.",
        messages: [{ role: "user", content: request || "(nothing was heard)" }],
      }),
    });
    if (!r.ok || !r.body) throw new Error(`anthropic ${r.status} ${(await r.text()).slice(0, 300)}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const d = JSON.parse(line.slice(6));
        if (d.type === "content_block_delta" && d.delta?.type === "text_delta") out += d.delta.text;
      }
    }
    return out.trim();
  }
}
