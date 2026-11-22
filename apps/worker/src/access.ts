/**
 * Every request is the person's only once Cloudflare Access has signed them in (section 7.1,
 * ADR 0009). Access stands in front of the Worker and puts a token it signed on each request it
 * lets through; the Worker checks that token against the keys the Access team publishes, on every
 * request, and holds no OAuth code and no keys of its own.
 */

/** The Access application a Deployment sits behind: its team's domain and its audience tag. */
export type AccessApplication = { teamDomain: string; audience: string };

/** One key Access signs with, as its team domain publishes it. */
export type AccessKey = JsonWebKey & { kid: string };

/**
 * The keys an Access team signs its tokens with. One of the faked things (section 13):
 * the real one reads them from the team domain, and tests sign with a key of their own.
 */
export interface AccessKeySet {
  /** Every key the team publishes now. Throws KeySetUnreachable when they cannot be read. */
  keys(): Promise<AccessKey[]>;
}

/** The keys could not be read: the network failed, or the team domain did not answer with them. */
export class KeySetUnreachable extends Error {}

/** The header Access puts its token for the application in, on every request it lets through. */
export const ACCESS_TOKEN_HEADER = "cf-access-jwt-assertion";

/** The keys an Access team publishes at its domain. */
export function publishedKeySet(teamDomain: string): AccessKeySet {
  return {
    async keys() {
      let response: Response;
      try {
        response = await fetch(new URL("/cdn-cgi/access/certs", teamDomain));
      } catch (error) {
        throw new KeySetUnreachable(`The Access keys could not be fetched: ${error}`);
      }
      if (!response.ok) {
        throw new KeySetUnreachable(`The Access team domain answered ${response.status}.`);
      }
      let published: unknown;
      try {
        published = await response.json();
      } catch {
        throw new KeySetUnreachable("The Access team domain answered with no key set.");
      }
      const keys = (published as { keys?: unknown }).keys;
      if (!Array.isArray(keys)) {
        throw new KeySetUnreachable("The Access team domain answered with no key set.");
      }
      return keys.filter(
        (key): key is AccessKey => typeof key === "object" && typeof key?.kid === "string",
      );
    },
  };
}

/**
 * Whether a request is the person's: signed in; signed out, which the person mends by signing in
 * again; or unavailable, when the keys to check it with cannot be read, which signing in again
 * does not mend.
 */
export type SignIn = "signed_in" | "signed_out" | "unavailable";

/** The one way Access signs its tokens: RS256. */
export const ACCESS_SIGNING = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** The Access a Deployment sits behind: its application, and the keys its team signs with. */
export type Access = { keySet: AccessKeySet; application: AccessApplication };

/**
 * Whose address a signed-in token carries: the person's, another's, none, or unset when the
 * Deployment names no address of the person's to tell.
 */
export type Whose = "person" | "other" | "none" | "unset";

/** An email as compared: neither its case nor the spaces around it tell two apart. */
const comparable = (email: string) => email.trim().toLowerCase();

/** Whose address a token the gate signed in carries, against the person's. */
export function whose(token: string, signInEmail: string): Whose {
  if (!comparable(signInEmail)) return "unset";
  const email = tokenParts(token)?.claims.email;
  if (typeof email !== "string" || !comparable(email)) return "none";
  return comparable(email) === comparable(signInEmail) ? "person" : "other";
}

/** The shortest time between two reads of the keys, so a stranger's tokens cannot make it fetch on every request. */
const REREAD_AFTER = 10_000;

/** How long keys once read are trusted, so a key Access has withdrawn stops working. */
const KEYS_KEPT_FOR = 60 * 60_000;

type Claims = { aud?: unknown; iss?: unknown; exp?: unknown; nbf?: unknown; email?: unknown };

function base64urlBytes(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64urlJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64urlBytes(part)));
}

/** The parts of a token, or null when it is no token signed the way Access signs. */
function tokenParts(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header = "", payload = "", signature = ""] = parts;
  try {
    const { alg, kid } = base64urlJson(header) as { alg?: unknown; kid?: unknown };
    const claims = base64urlJson(payload);
    if (alg !== "RS256" || typeof kid !== "string") return null;
    if (typeof claims !== "object" || claims === null) return null;
    return {
      kid,
      claims: claims as Claims,
      signed: new TextEncoder().encode(`${header}.${payload}`),
      signature: base64urlBytes(signature),
    };
  } catch {
    return null;
  }
}

/** Whether the claims are this application's, from this team, and good at this time. */
function claimsHold(claims: Claims, application: AccessApplication, now: number): boolean {
  if (!application.teamDomain || !application.audience) return false;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(application.audience)) return false;
  if (claims.iss !== application.teamDomain) return false;
  if (typeof claims.exp !== "number" || now >= claims.exp * 1000) return false;
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || now < claims.nbf * 1000)) {
    return false;
  }
  return true;
}

/**
 * The check every request passes before anything else. It reads the keys and trusts them for an
 * hour, reading them again sooner when a token names a key it does not hold, as after Access
 * rotates its keys, but never twice in ten seconds, whether the read worked or not.
 */
export class AccessGate {
  readonly #keySet: AccessKeySet;
  readonly #application: AccessApplication;
  #keys = new Map<string, CryptoKey>();
  #readAt: number | null = null;
  #triedAt: number | null = null;

  constructor({ keySet, application }: Access) {
    this.#keySet = keySet;
    // Access names its team without a trailing slash, however the Deployment's setting is typed.
    this.#application = { ...application, teamDomain: application.teamDomain.replace(/\/+$/, "") };
  }

  async check(token: string | null, now: number): Promise<SignIn> {
    const parts = token ? tokenParts(token) : null;
    if (!parts || !claimsHold(parts.claims, this.#application, now)) return "signed_out";

    const kept = this.#readAt !== null && now - this.#readAt < KEYS_KEPT_FOR;
    let key = kept ? this.#keys.get(parts.kid) : undefined;
    if (!key) {
      // Whether the token is good cannot be told until the keys are read again, which signing
      // in again would not hasten.
      if (this.#triedAt !== null && now - this.#triedAt < REREAD_AFTER) return "unavailable";
      this.#triedAt = now;
      try {
        await this.#read(now);
      } catch (error) {
        if (error instanceof KeySetUnreachable) return "unavailable";
        throw error;
      }
      key = this.#keys.get(parts.kid);
      if (!key) return "signed_out";
    }

    const verified = await crypto.subtle.verify(ACCESS_SIGNING, key, parts.signature, parts.signed);
    return verified ? "signed_in" : "signed_out";
  }

  async #read(now: number) {
    const published = await this.#keySet.keys();
    const keys = new Map<string, CryptoKey>();
    for (const { kid, kty, n, e } of published) {
      if (kty !== "RSA" || !n || !e) continue;
      try {
        keys.set(
          kid,
          await crypto.subtle.importKey("jwk", { kty, n, e }, ACCESS_SIGNING, false, ["verify"]),
        );
      } catch {
        // A key that cannot be read verifies nothing; the others still do.
      }
    }
    this.#keys = keys;
    this.#readAt = now;
  }
}
