import type { PushSubscription } from "@praxis/domain";
import { describe, expect, inject, test } from "vitest";
import {
  base64url,
  encrypted,
  fromBase64url,
  type Notification,
  type PushSender,
  webPushSender,
} from "../src/push.ts";
import { makePushKeys } from "../src/push-keys.ts";
import { fakePush, subscribe, unsubscribe } from "./push-fake.ts";

// The Web Push sender's one contract suite (section 13). In CI it runs against the fake and
// against the real sender talking to a stand-in push service. By hand it runs against a real push
// service too, given the Deployment's key pair, its subject and a subscription a browser made for
// that key, and optionally one since unsubscribed:
//
//   PUSH_PUBLIC_KEY=<base64url> PUSH_PRIVATE_KEY='<JWK>' PUSH_SUBJECT=https://praxis.example.com \
//   PUSH_SUBSCRIPTION='<PushSubscription.toJSON()>' [PUSH_GONE_SUBSCRIPTION='<…>'] \
//   bun run --cwd apps/worker test push
//
// The real one should then show "Contract: your Brief is ready" on that browser.

const AT = Date.parse("2026-11-16T07:00:00.000Z");

const NOTIFICATION: Notification = {
  title: "Contract: your Brief is ready",
  tag: "brief:contract",
  open: "/?context=contract&peer=conversation",
};

/** A push service a sender talks to, and subscriptions it holds as live and as gone. */
type Service = {
  sender: PushSender;
  /** A subscription the service takes Notifications for. */
  live: () => PushSubscription;
  /** One whose browser has unsubscribed, which the service says is gone; null when none given. */
  gone: () => PushSubscription | null;
  /** The time to sign by. */
  at: number;
};

function contract(name: string, service: () => Promise<Service>) {
  describe(`the Web Push sender: ${name}`, () => {
    test("a Notification to a live subscription is sent", async () => {
      const { sender, live, at } = await service();

      expect(await sender.send(live(), NOTIFICATION, { topic: "brief-contract", at })).toBe("sent");
    });

    test("one to a subscription its browser has given up is gone", async (context) => {
      const { sender, gone, at } = await service();
      const given = gone();
      if (given === null) return context.skip();

      expect(await sender.send(given, NOTIFICATION, { topic: "brief-contract", at })).toBe("gone");
    });

    test("there is a public key a browser subscribes with", async () => {
      const { sender } = await service();

      expect(sender.publicKey).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+$/));
    });
  });
}

contract("the fake", async () => ({
  sender: fakePush,
  live: subscribe,
  gone: () => {
    const given = subscribe();
    unsubscribe(given);
    return given;
  },
  at: AT,
}));

contract("the real sender, at a stand-in push service", async () => {
  const keys = await makePushKeys();
  const service = await standIn(keys.publicKey);
  return {
    sender: webPushSender({ ...keys, subject: "https://praxis.test" }, service.fetch),
    live: () => service.subscribe(),
    gone: () => service.unsubscribed(),
    at: AT,
  };
});

const real = inject("realPush");
if (real) {
  contract("a real push service", async () => ({
    sender: webPushSender(real),
    live: () => JSON.parse(real.subscription),
    gone: () => (real.gone ? JSON.parse(real.gone) : null),
    // A push service checks the signature's expiry by the real clock.
    at: Date.now(),
  }));
}

// The parts of the real sender the stand-in cannot judge alone: the encryption, against RFC 8291's
// own worked example, and the request, as RFC 8030 and RFC 8292 shape it.

describe("the real sender's encryption", () => {
  test("is RFC 8291's: its worked example comes out byte for byte", async () => {
    // Appendix A of RFC 8291.
    const asPublic = fromBase64url(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    );
    const asPrivate = await importEcdh(asPublic, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
    const subscription: PushSubscription = {
      endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
      keys: {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg", // gitleaks:allow RFC 8291's published example, not a secret
      },
    };

    const body = await encrypted(
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      subscription,
      { publicKey: asPublic, privateKey: asPrivate },
      fromBase64url("DGv6ra1nlYgDCS1FRnbzlw"),
    );

    const header = fromBase64url(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    );
    const ciphertext = fromBase64url(
      "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
    );
    expect(base64url(body)).toBe(base64url(new Uint8Array([...header, ...ciphertext])));
  });
});

describe("the real sender's request", () => {
  test("is encrypted, says how long to keep it and what it replaces, and is signed for the push service", async () => {
    const keys = await makePushKeys();
    const service = await standIn(keys.publicKey);
    const sender = webPushSender({ ...keys, subject: "https://praxis.test" }, service.fetch);
    const to = service.subscribe();

    await sender.send(to, NOTIFICATION, { topic: "brief-contract", at: AT });

    const [request] = service.requests;
    expect(request?.url).toBe(to.endpoint);
    expect(request?.method).toBe("POST");
    expect(Object.fromEntries(request?.headers ?? [])).toMatchObject({
      "content-encoding": "aes128gcm",
      ttl: "86400",
      topic: "brief-contract",
      urgency: "normal",
    });
    const authorization = request?.headers.get("authorization") ?? "";
    const [, token = "", key] = /^vapid t=([^,]+), k=(\S+)$/.exec(authorization) ?? [];
    expect(key).toBe(keys.publicKey);
    const [head = "", claims = "", signature = ""] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(head)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims)))).toEqual({
      aud: "https://push.praxis.test",
      exp: AT / 1000 + 12 * 60 * 60,
      sub: "https://praxis.test",
    });
    const verifier = await crypto.subtle.importKey(
      "raw",
      fromBase64url(keys.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verifier,
        fromBase64url(signature),
        new TextEncoder().encode(`${head}.${claims}`),
      ),
    ).toBe(true);
    // The body opens with RFC 8188's header: a salt, a record size of 4096 and a new key each time.
    const body = new Uint8Array((await request?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);
  });

  test("a push service that cannot be reached, or refuses for any other reason, is a failure", async () => {
    const keys = await makePushKeys();
    const service = await standIn(keys.publicKey);
    const to = service.subscribe();
    const failing = (fetcher: typeof fetch) =>
      webPushSender({ ...keys, subject: "https://praxis.test" }, fetcher).send(to, NOTIFICATION, {
        topic: "brief-contract",
        at: AT,
      });

    expect(
      await Promise.all([
        failing(async () => {
          throw new TypeError("Network connection lost.");
        }),
        failing(async () => new Response("Too many", { status: 429 })),
        failing(async () => new Response("Down", { status: 503 })),
      ]),
    ).toEqual(["failed", "failed", "failed"]);
  });
});

/** An ECDH private key from its raw scalar and the public key it goes with. */
async function importEcdh(publicKey: Uint8Array, d: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64url(publicKey.slice(1, 33)),
      y: base64url(publicKey.slice(33, 65)),
      d,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

/**
 * A push service in the test's own isolate: it hands out subscriptions at its own endpoints, takes
 * a request to one whose browser is still subscribed and signed with the key it was made for, and
 * answers 410 for one given up, as RFC 8030 says.
 */
async function standIn(publicKey: string) {
  const subscribed = new Set<string>();
  const requests: Request[] = [];
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const keys = {
    p256dh: base64url(new Uint8Array(raw as ArrayBuffer)),
    auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const make = (): PushSubscription => {
    const endpoint = `https://push.praxis.test/${crypto.randomUUID()}`;
    subscribed.add(endpoint);
    return { endpoint, keys };
  };
  return {
    requests,
    subscribe: make,
    unsubscribed(): PushSubscription {
      const given = make();
      subscribed.delete(given.endpoint);
      return given;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (!subscribed.has(request.url)) return new Response(null, { status: 410 });
      const signedFor = /, k=(\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
      if (signedFor !== publicKey) return new Response(null, { status: 403 });
      return new Response(null, { status: 201 });
    }) as typeof fetch,
  };
}
