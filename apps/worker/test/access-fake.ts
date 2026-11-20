import type { AccessApplication, AccessKey, AccessKeySet } from "../src/access.ts";
import { ACCESS_SIGNING, KeySetUnreachable } from "../src/access.ts";

// The Access key set is one of the faked things (section 13). The fake publishes a key of
// its own and signs tokens with it as Access would, so tests sign in without Access. It uses
// nothing but Web Crypto, so the Vitest suite in workerd and the stand-in for Access in front of
// `wrangler dev` (scripts/access-stand-in.ts) share it.

/** The Access application the tests' Deployment sits behind. */
export const TEST_APPLICATION: AccessApplication = {
  teamDomain: "https://praxis-test.cloudflareaccess.com",
  audience: "praxis-test-audience",
};

type SigningKey = { kid: string; pair: CryptoKeyPair };

async function makeKey(): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey(
    { ...ACCESS_SIGNING, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return { kid: crypto.randomUUID(), pair };
}

async function published(key: SigningKey): Promise<AccessKey> {
  const { kty, n, e } = (await crypto.subtle.exportKey("jwk", key.pair.publicKey)) as JsonWebKey;
  return { kid: key.kid, kty: kty ?? "RSA", alg: "RS256", use: "sig", n: n ?? "", e: e ?? "" };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function encoded(part: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(part)));
}

/** A token signed with this key, carrying these claims, as Access shapes its application token. */
export async function signToken(
  key: SigningKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const signed = `${encoded({ alg: "RS256", kid: key.kid, typ: "JWT", ...header })}.${encoded(claims)}`;
  const signature = await crypto.subtle.sign(
    ACCESS_SIGNING,
    key.pair.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64url(new Uint8Array(signature))}`;
}

/** How long a token the fake signs is good for, as Access's default session. */
export const TOKEN_LIFE = 24 * 60 * 60 * 1000;

/** A stand-in for one Access application's key set, publishing one key until it is rotated. */
export async function fakeAccess(application: AccessApplication) {
  let current = await makeKey();
  let publishedKeys = [await published(current)];
  let reachable = true;

  const keySet: AccessKeySet = {
    async keys() {
      if (!reachable) throw new KeySetUnreachable("The fake key set is switched off.");
      return publishedKeys;
    },
  };

  return {
    keySet,
    /**
     * A token Access would put on a request at this time, for the person, good for a day. The
     * claims can be changed to make one Access would not.
     */
    sign(at: number, claims: Record<string, unknown> = {}) {
      const seconds = Math.floor(at / 1000);
      return signToken(current, {
        aud: [application.audience],
        email: "the.person@praxis.test",
        exp: seconds + TOKEN_LIFE / 1000,
        iat: seconds,
        nbf: seconds,
        iss: application.teamDomain,
        type: "app",
        sub: "the-person",
        ...claims,
      });
    },
    /**
     * Sign with a new key, published beside the old one as Access rotates its keys, or alone, as
     * when Access withdraws a key.
     */
    async rotate({ withdraw = false } = {}) {
      current = await makeKey();
      const added = await published(current);
      publishedKeys = withdraw ? [added] : [...publishedKeys, added];
    },
    /** Make the key set unreachable, as a network failure would, or reachable again. */
    setReachable(to: boolean) {
      reachable = to;
    },
  };
}

/** A key Access never published, to sign a token no key in the set verifies. */
export function strangerKey(): Promise<SigningKey> {
  return makeKey();
}
