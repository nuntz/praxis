// PROTOTYPE. The one page of the Call probe: starts the Call from the browser and shows what the object saw.

export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Call probe (prototype)</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.45 system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 980px; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .note { opacity: .7; margin: 0 0 12px; }
  fieldset { border: 1px solid #8886; border-radius: 8px; margin: 0 0 12px; padding: 10px 12px; }
  label { display: block; margin: 6px 0; }
  textarea { box-sizing: border-box; font: inherit; height: 110px; width: 100%; }
  button { font: inherit; margin-right: 6px; padding: 6px 14px; }
  #facts { display: grid; gap: 4px 16px; grid-template-columns: max-content 1fr; }
  #facts dt { opacity: .7; } #facts dd { margin: 0; overflow-wrap: anywhere; }
  .row { border-top: 1px solid #8883; display: grid; gap: 10px; grid-template-columns: 62px 150px 1fr; padding: 5px 0; }
  .row .t { font-variant-numeric: tabular-nums; opacity: .6; }
  .row .k { font-weight: 600; }
  .row .b { overflow-wrap: anywhere; white-space: pre-wrap; }
  .person .k { color: #2a7; } .voice .k { color: #c70; } .hand .k { color: #a4f; } .run .k { color: #48f; }
  .bad .k { color: #e33; } .side .k { opacity: .75; }
  .alone { background: #c701; }
  details pre { font-size: 12px; max-height: 420px; overflow: auto; white-space: pre-wrap; }
</style>

<h1>Call probe</h1>
<p class="note">Prototype, throwaway. Sound goes between this browser and the voice provider. The Durable Object follows the side channel and stands in for a Run.</p>

<fieldset>
  <legend>Setup</legend>
  <label>Who carries the Call
    <select id="carrier">
      <option value="browser">this device, on its data channel (the object attaches to nothing)</option>
      <option value="side">the object, on the side channel (it is sent the sound)</option>
    </select>
  </label>
  <label>Stand-in for a Run
    <select id="mode">
      <option value="stream">streamed subrequest, fixed answer (tests the workerd drop)</option>
      <option value="plain">no subrequest, fixed answer</option>
      <option value="anthropic">real streamed model call (needs ANTHROPIC_API_KEY)</option>
    </select>
  </label>
  <label>Wait after a handover before reading the transcript, in ms
    <input id="settle" type="number" value="0" min="0" step="100" style="width: 90px">
  </label>
  <label>Instructions to the voice model
    <textarea id="instructions">You are the voice of an assistant. You know nothing yourself and you have no tools. Hand every request from the person to the backend, including plain questions and small talk, and never answer from your own knowledge. While you wait you may say a few words such as "one moment". When the backend's answer comes, speak it briefly and faithfully: keep every name, title and date exactly as given.</textarea>
  </label>
  <button id="start">Start Call</button>
  <button id="mute" disabled>Mute</button>
  <button id="end" disabled>End (leave)</button>
  <button id="dcclose" disabled>End (device sends session.close)</button>
  <button id="close" disabled>End (object attaches if need be, sends session.close)</button>
  <button id="guess" disabled>Object guesses at a hangup endpoint</button>
  <button id="wipe">Wipe log</button>
</fieldset>

<fieldset>
  <legend>State</legend>
  <dl id="facts"></dl>
</fieldset>

<fieldset>
  <legend>Timeline</legend>
  <div id="timeline"></div>
</fieldset>

<details><summary>Raw log from the object</summary><pre id="raw"></pre></details>
<details><summary>Raw events on the browser's data channel</summary><pre id="dc"></pre></details>
<audio id="audio" autoplay></audio>

<script>
const k = new URLSearchParams(location.search).get("k");
const api = (p) => p + (p.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(k);
const $ = (id) => document.getElementById(id);
let pc, mic, dc, since = 0, rows = [], t0 = 0, facts = {}, dcLog = [], outbox = [], heard = "", carrier = "browser";
const post = (p, body) => fetch(api(p), { method: "POST", body: JSON.stringify(body) });
const note = (kind, body) => outbox.push({ at: Date.now(), kind, body });
setInterval(() => { if (outbox.length) post("/api/log", { events: outbox.splice(0) }); }, 700);
function dcSend(ev) { dc.send(JSON.stringify(ev)); note("sent", ev); }

// The device carries the Call: rebuild the request from what was heard, ask the object, hand the answer back.
async function handover(ev) {
  const settle = Number($("settle").value);
  if (settle) await new Promise((r) => setTimeout(r, settle));
  const request = heard.trim();
  heard = "";
  const started = Date.now();
  const r = await post("/api/run", { request, mode: $("mode").value });
  const { answer } = await r.json();
  note("device.run.roundtrip", { ms: Date.now() - started });
  dcSend({ type: "session.commentary.append", event_id: "result_" + started, delegation_id: ev.delegation.id, content: answer });
}

function fact(name, value) { facts[name] = value; renderFacts(); }
function renderFacts() {
  $("facts").innerHTML = Object.entries(facts).map(([a, b]) => "<dt>" + a + "</dt><dd>" + esc(String(b)) + "</dd>").join("");
}
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

$("start").onclick = async () => {
  await fetch(api("/api/wipe"), { method: "POST" });
  since = 0; rows = []; dcLog = []; facts = {}; t0 = Date.now(); heard = ""; carrier = $("carrier").value;
  pc = new RTCPeerConnection();
  pc.ontrack = (e) => { $("audio").srcObject = e.streams[0]; };
  pc.onconnectionstatechange = () => { fact("WebRTC", pc.connectionState); if (pc.connectionState === "connected") route(); };
  mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  mic.getTracks().forEach((t) => pc.addTrack(t, mic));
  dc = pc.createDataChannel("oai-events");
  dc.onclose = () => note("device.datachannel.close", {});
  dc.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    dcLog.push(ev);
    if (carrier === "browser") {
      // Any sound on the data channel would be a finding: note its type, never its bytes.
      if (/_audio\./.test(ev.type)) note("device.audio.on.datachannel", { type: ev.type });
      else note("in:" + ev.type, ev);
      if (ev.type === "session.input_transcript.delta") heard += ev.delta;
      if (ev.type === "session.delegation.created") handover(ev);
    }
    if (!/transcript\\.delta$/.test(ev.type)) $("dc").textContent += JSON.stringify(ev) + "\\n";
    if (ev.session && ev.session.expires_at) {
      const left = ev.session.expires_at * 1000 - Date.now();
      fact("Session expires_at", new Date(ev.session.expires_at * 1000).toLocaleTimeString() + " (" + Math.round(left / 60000) + " min from " + ev.type + ")");
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const r = await fetch(api("/api/session"), {
    method: "POST",
    body: JSON.stringify({ carrier, sdp: offer.sdp, mode: $("mode").value, settleMs: Number($("settle").value), instructions: $("instructions").value }),
  });
  if (!r.ok) { fact("Session", "failed: " + (await r.text()).slice(0, 400)); return; }
  const created = await r.json();
  fact("Session", created.session.id);
  await pc.setRemoteDescription({ type: "answer", sdp: created.transport.sdp });
  $("mute").disabled = $("end").disabled = $("close").disabled = $("dcclose").disabled = $("guess").disabled = false;
};

// Where the sound goes: the far end of the selected candidate pair.
async function route() {
  const stats = await pc.getStats();
  stats.forEach((s) => {
    if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
      const remote = stats.get(s.remoteCandidateId), local = stats.get(s.localCandidateId);
      fact("Sound goes to", remote.address + ":" + remote.port + " (" + remote.candidateType + ", " + remote.protocol + "), from a local " + local.candidateType + " candidate");
    }
  });
}

$("mute").onclick = () => {
  const t = mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $("mute").textContent = t.enabled ? "Mute" : "Unmute";
};
$("end").onclick = () => { pc.close(); mic.getTracks().forEach((t) => t.stop()); fact("WebRTC", "closed by this page"); };
$("close").onclick = () => fetch(api("/api/close"), { method: "POST" });
$("dcclose").onclick = () => dcSend({ type: "session.close", event_id: "close_" + Date.now() });
$("guess").onclick = () => fetch(api("/api/guess"), { method: "POST" });
$("wipe").onclick = async () => { await fetch(api("/api/wipe"), { method: "POST" }); since = 0; rows = []; render(); };

async function poll() {
  try {
    const s = await (await fetch(api("/api/state?since=" + since))).json();
    if (s.rows.length) { rows.push(...s.rows); rows.sort((a, b) => a.at - b.at || a.id - b.id); since = Math.max(...rows.map((r) => r.id)); render(); }
    fact("Object boot id", s.boot);
    fact("Side channel", s.sidebandOpen ? "open" : "not open");
    fact("Call, as the object knows it", s.sessionOver ? "over or not started" : "on");
    const usage = [...rows].reverse().find((r) => r.kind === "in:session.usage.updated");
    if (usage) fact("Provider usage", JSON.stringify(JSON.parse(usage.body).usage));
    const boots = new Set(rows.map((r) => r.boot));
    fact("Object boots seen in this log", boots.size);
  } catch (e) { fact("Poll", "failed: " + e); }
  setTimeout(poll, 1000);
}

function render() {
  if (!rows.length) { $("timeline").innerHTML = ""; $("raw").textContent = ""; return; }
  const start = rows[0].at;
  // Fold transcript fragments into one line per stretch of speech.
  const lines = [];
  let handedSincePerson = false;
  for (const r of rows) {
    const b = JSON.parse(r.body);
    const t = ((r.at - start) / 1000).toFixed(1);
    const last = lines[lines.length - 1];
    if (r.kind === "in:session.input_transcript.delta") {
      if (last && last.cls === "person") last.text += b.delta;
      else { lines.push({ t, cls: "person", k: "PERSON said", text: b.delta }); handedSincePerson = false; }
    } else if (r.kind === "in:session.output_transcript.delta") {
      if (last && last.cls.startsWith("voice")) last.text += b.delta;
      else lines.push({ t, cls: handedSincePerson ? "voice" : "voice alone", k: handedSincePerson ? "VOICE spoke" : "VOICE spoke, no handover yet", text: b.delta });
    } else if (r.kind === "in:session.delegation.created") {
      handedSincePerson = true;
      lines.push({ t, cls: "hand", k: "HANDOVER", text: JSON.stringify(b.delegation) });
    } else if (r.kind === "run.start") lines.push({ t, cls: "run", k: "RUN request", text: "[" + b.mode + "] " + (b.request || "(empty)") });
    else if (r.kind === "run.end") lines.push({ t, cls: "run", k: "RUN answer", text: "(" + b.ms + " ms) " + b.answer });
    else if (r.kind === "sent") lines.push({ t, cls: "side", k: "sent " + b.type, text: "" });
    else if (/failed|refused|threw|error|close$/.test(r.kind)) lines.push({ t, cls: "bad", k: r.kind, text: r.body });
    else if (r.kind === "in:session.usage.updated") continue;
    else lines.push({ t, cls: "side", k: r.kind.replace(/^in:/, ""), text: r.kind.startsWith("in:") ? "" : r.body });
  }
  $("timeline").innerHTML = lines.map((l) =>
    '<div class="row ' + l.cls + '"><span class="t">' + l.t + 's</span><span class="k">' + esc(l.k) + '</span><span class="b">' + esc(l.text) + "</span></div>").join("");
  $("raw").textContent = rows.map((r) => ((r.at - start) / 1000).toFixed(2) + " " + r.boot + " " + r.kind + " " + r.body).join("\\n");
}

poll();
</script>
</html>`;
