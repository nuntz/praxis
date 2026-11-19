import type { ClockKind, PushSubscription } from "@praxis/domain";

/**
 * Sending a Notification by Web Push (section 8.7, ADR 0013). One of the four faked things
 * (section 13): the real one signs with the Deployment's key pair and encrypts to the Device's
 * subscription, and tests take what is sent from the fake in test/push-fake.ts.
 */
export interface PushSender {
  /**
   * The public key of the Deployment's signing key pair, base64url, which a browser subscribes
   * with; null when the Deployment has none, so no Device can be switched on.
   */
  readonly publicKey: string | null;
  /**
   * Send a Notification to one Device. `topic` names what it replaces at the push service while
   * not yet delivered, and `at` is the time to sign by. "gone" when the push service says the
   * subscription no longer exists, "failed" for anything else it refused or a network failure.
   */
  send(
    to: PushSubscription,
    notification: Notification,
    options: { topic: string; at: number },
  ): Promise<"sent" | "gone" | "failed">;
}

/**
 * What a Notification carries to the Device's service worker: fixed wording naming the kind and the
 * Context, and nothing from the Message or the Journal (ADR 0013).
 */
export type Notification = {
  /** Such as "Work: your Brief is ready". */
  title: string;
  /** One per kind and Context, so a new Brief's replaces the last on a Device. */
  tag: string;
  /** Where a tap opens: that Context's Conversation. */
  open: string;
};

/** How long a push service keeps a Notification for a Device it cannot reach: one day. */
const KEPT_FOR = 24 * 60 * 60;

/** How long a signature is good for: RFC 8292 allows a day at most. */
const SIGNED_FOR = 12 * 60 * 60;

/** The record size of RFC 8188, which a Notification never comes near. */
const RECORD_SIZE = 4096;

/** Web Push with the Deployment's signing key pair, from its configuration. */
export function webPush(env: Env): PushSender {
  const publicKey = env.PUSH_PUBLIC_KEY;
  const privateKey = env.PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return {
      publicKey: null,
      async send() {
        return "failed";
      },
    };
  }
  return webPushSender({ publicKey, privateKey, subject: env.PUSH_SUBJECT });
}

/**
 * The real sender: each Notification encrypted to the Device's keys as RFC 8291 says, and the
 * request signed with the Deployment's key pair as RFC 8292 says, so the push service knows it
 * came from the key the browser subscribed with. `fetcher` is the network, or a stand-in in tests.
 */
export function webPushSender(
  keys: {
    /** The public key, raw and base64url, as a browser takes it. */
    publicKey: string;
    /** The private key, a JWK as JSON. */
    privateKey: string;
    /** Who the push services are told sends: the Deployment's own address. */
    subject: string;
  },
  fetcher: typeof fetch = fetch,
): PushSender {
  const signing = importSigningKey(keys.privateKey);
  return {
    publicKey: keys.publicKey,
    async send(to, notification, { topic, at }) {
      const body = await encrypted(
        new TextEncoder().encode(JSON.stringify(notification)),
        to,
        await oneTimeKeys(),
        crypto.getRandomValues(new Uint8Array(16)),
      );
      const token = await signed(await signing, {
        aud: new URL(to.endpoint).origin,
        exp: Math.floor(at / 1000) + SIGNED_FOR,
        sub: keys.subject,
      });
      let response: Response;
      try {
        response = await fetcher(to.endpoint, {
          method: "POST",
          headers: {
            authorization: `vapid t=${token}, k=${keys.publicKey}`,
            "content-encoding": "aes128gcm",
            "content-type": "application/octet-stream",
            ttl: String(KEPT_FOR),
            topic,
            urgency: "normal",
          },
          body,
        });
      } catch {
        return "failed";
      }
      // The push service took it; or the browser gave the subscription up, for good.
      if (response.ok) return "sent";
      if (response.status === 404 || response.status === 410) return "gone";
      return "failed";
    },
  };
}

/**
 * What a Notification replaces at the push service while it waits there undelivered: the last of
 * its kind for its Context. A topic is at most 32 characters of base64url (RFC 8030).
 */
export async function topicOf(contextId: string, kind: ClockKind): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}:${contextId}`),
  );
  return base64url(new Uint8Array(digest)).slice(0, 32);
}

/**
 * A message body as RFC 8291 encrypts one for a subscription: one RFC 8188 record, under a key
 * agreed between a key pair made for this message alone and the subscription's, salted, and
 * bound to the subscription's authentication secret.
 */
export async function encrypted(
  plaintext: Uint8Array,
  to: PushSubscription,
  sender: { publicKey: Uint8Array; privateKey: CryptoKey },
  salt: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = fromBase64url(to.keys.p256dh);
  const auth = fromBase64url(to.keys.auth);
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhWith(uaKey), sender.privateKey, 256),
  );
  const prkKey = await hmac(auth, shared);
  const keyInfo = joined(utf8("WebPush: info\0"), uaPublic, sender.publicKey);
  const ikm = await hmac(prkKey, joined(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, joined(utf8("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, joined(utf8("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record, the last, so its padding delimiter is 2.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, joined(plaintext, [2])),
  );
  const header = new Uint8Array(21);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header.set(salt, 0);
  header[20] = sender.publicKey.length;
  return joined(header, sender.publicKey, ciphertext);
}

/** A key pair for one message's encryption alone, its public key raw. */
async function oneTimeKeys(): Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  return { publicKey: new Uint8Array(raw), privateKey: pair.privateKey };
}

/**
 * ECDH with the other side's public key. Web Crypto names the field `public`, which workerd's
 * types spell `$public`, a reserved word in their generator; the runtime takes `public`.
 */
function ecdhWith(publicKey: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  return { name: "ECDH", public: publicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
}

/** The private half of the signing key pair, from the JWK the wizard made, for signing only. */
async function importSigningKey(jwk: string): Promise<CryptoKey> {
  const { x, y, d } = JSON.parse(jwk) as JsonWebKey;
  if (!x || !y || !d) throw new Error("PUSH_PRIVATE_KEY is no P-256 private key as a JWK.");
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** A JWT signed ES256, as RFC 8292 asks of the application server. */
async function signed(key: CryptoKey, claims: Record<string, unknown>): Promise<string> {
  const part = (value: object) => base64url(utf8(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function joined(...parts: (Uint8Array | number[])[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
