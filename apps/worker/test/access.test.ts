import { describe, expect, inject, test } from "vitest";
import { type Access, AccessGate, type AccessKeySet, publishedKeySet } from "../src/access.ts";
import {
  fakeAccess,
  SOMEONE_ELSES_EMAIL,
  signToken,
  strangerKey,
  TEST_APPLICATION,
  THE_PERSONS_EMAIL,
  TOKEN_LIFE,
} from "./access-fake.ts";

// The Access key set's one contract suite (section 13). In CI it runs against the fake. By hand
// it runs against a real Access application too, given its team domain, its audience tag and a
// token for it, which `cloudflared access token -app=<the Deployment's address>` prints:
//
//   ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com ACCESS_AUD=<tag> \
//   ACCESS_EMAIL=<the Google address it was signed in with> \
//   ACCESS_TOKEN=$(cloudflared access token -app=https://praxis.example.com) \
//   bun run --cwd apps/worker test access
//
// What it checks is the gate the Worker puts every request through, holding the key set, and that
// the token carries the address it was signed in with.

/** A key set and a token it signed, for one Access application and the address signed in to it. */
type Service = {
  access: Access;
  /** A token the service signed, and a time at which it is good. */
  token: () => Promise<{ token: string; at: number }>;
  /** The same key set, as it is when the network fails on the way to it. */
  unreachable: AccessKeySet;
};

const START = Date.parse("2026-11-15T09:00:00.000Z");

/** The claims of a token, read without checking it, for the test's own times. */
function claimsOf(token: string): { exp: number } {
  const [, payload = ""] = token.split(".");
  return JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
}

/** The token with one character of its signature changed. */
function altered(token: string): string {
  const last = token.at(-2) === "A" ? "B" : "A";
  return `${token.slice(0, -2)}${last}${token.slice(-1)}`;
}

function contract(name: string, service: () => Promise<Service>) {
  describe(`the Access key set: ${name}`, () => {
    test("a token the service signed is signed in, while it is good", async () => {
      const { access, token } = await service();
      const signed = await token();

      expect(await new AccessGate(access).check(signed.token, signed.at)).toBe("signed_in");
    });

    test("the same token is not the person's when the Deployment names another address", async () => {
      const { access, token } = await service();
      const signed = await token();

      expect(
        await new AccessGate({ ...access, signInEmail: SOMEONE_ELSES_EMAIL }).check(
          signed.token,
          signed.at,
        ),
      ).toBe("other");
    });

    test("the same token is signed out once it has expired", async () => {
      const { access, token } = await service();
      const { token: signed } = await token();
      const expired = claimsOf(signed).exp * 1000;

      expect(await new AccessGate(access).check(signed, expired)).toBe("signed_out");
    });

    test("a token whose signature was changed is signed out", async () => {
      const { access, token } = await service();
      const signed = await token();

      expect(await new AccessGate(access).check(altered(signed.token), signed.at)).toBe(
        "signed_out",
      );
    });

    test("a token for another Access application, or another team, is signed out", async () => {
      const { access, token } = await service();
      const signed = await token();

      for (const other of [
        { ...access.application, audience: "another-application" },
        { ...access.application, teamDomain: "https://another-team.cloudflareaccess.com" },
      ]) {
        expect(
          await new AccessGate({ ...access, application: other }).check(signed.token, signed.at),
        ).toBe("signed_out");
      }
    });

    test("a token signed by a key the service never published is signed out", async () => {
      const { access, token } = await service();
      const { at } = await token();
      const forged = await signToken(await strangerKey(), {
        aud: [access.application.audience],
        iss: access.application.teamDomain,
        exp: Math.floor(at / 1000) + 60,
        nbf: Math.floor(at / 1000) - 60,
      });

      expect(await new AccessGate(access).check(forged, at)).toBe("signed_out");
    });

    test("a key set that cannot be reached is told apart from a sign-in that lapsed", async () => {
      const { access, token, unreachable } = await service();
      const signed = await token();

      expect(
        await new AccessGate({ ...access, keySet: unreachable }).check(signed.token, signed.at),
      ).toBe("unavailable");
    });
  });
}

const APPLICATION = TEST_APPLICATION;

contract("the fake", async () => {
  const fake = await fakeAccess(APPLICATION);
  return {
    access: fake.setup(),
    token: async () => ({ token: await fake.sign(START), at: START + 60_000 }),
    unreachable: {
      keys: () => {
        fake.setReachable(false);
        return fake.keySet.keys();
      },
    },
  };
});

const real = inject("realAccess");
if (real) {
  contract("Cloudflare Access", async () => ({
    access: {
      application: { teamDomain: real.teamDomain, audience: real.audience },
      keySet: publishedKeySet(real.teamDomain),
      signInEmail: real.email,
    },
    token: async () => ({ token: real.token, at: Date.now() }),
    // A name that can never resolve, so the fetch fails as a network failure would.
    unreachable: publishedKeySet("https://praxis-contract.invalid"),
  }));
}

describe("the gate the Worker puts every request through", () => {
  test("a request with no token, or one that is no token at all, is signed out", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());

    for (const token of [null, "", "not-a-token", "a.b.c", "....."]) {
      expect(await gate.check(token, START)).toBe("signed_out");
    }
  });

  test("a token before the time it is good from is signed out", async () => {
    const access = await fakeAccess(APPLICATION);
    const token = await access.sign(START);

    expect(await new AccessGate(access.setup()).check(token, START - 60_000)).toBe("signed_out");
  });

  test("a token is good until its expiry and not at it", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    const token = await access.sign(START);

    expect(await gate.check(token, START + TOKEN_LIFE - 1)).toBe("signed_in");
    expect(await gate.check(token, START + TOKEN_LIFE)).toBe("signed_out");
  });

  test("a token that names no algorithm, or another one, is signed out", async () => {
    const access = await fakeAccess(APPLICATION);
    const token = await access.sign(START);
    const [, payload, signature] = token.split(".");
    const gate = new AccessGate(access.setup());

    for (const alg of ["none", "HS256"]) {
      const header = btoa(JSON.stringify({ alg, typ: "JWT" })).replace(/=+$/, "");
      expect(await gate.check(`${header}.${payload}.${signature}`, START)).toBe("signed_out");
    }
  });

  test("a token signed with a key Access has rotated in since is signed in", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    expect(await gate.check(await access.sign(START), START)).toBe("signed_in");

    await access.rotate();

    expect(await gate.check(await access.sign(START), START + 60_000)).toBe("signed_in");
  });

  test("a key rotated in moments after the keys were read is unavailable, not a lapsed sign-in", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    expect(await gate.check(await access.sign(START), START)).toBe("signed_in");

    await access.rotate();
    const signed = await access.sign(START);

    // Signing in again would not mend it; trying again shortly does.
    expect(await gate.check(signed, START + 1_000)).toBe("unavailable");
    expect(await gate.check(signed, START + 10_000)).toBe("signed_in");
  });

  test("tokens naming keys the gate does not hold make it read the keys at most once in ten seconds, reachable or not", async () => {
    const access = await fakeAccess(APPLICATION);
    let reads = 0;
    const counted = {
      keys: () => {
        reads += 1;
        return access.keySet.keys();
      },
    };
    const gate = new AccessGate(access.setup({ keySet: counted }));
    const stranger = await signToken(await strangerKey(), {
      aud: [APPLICATION.audience],
      iss: APPLICATION.teamDomain,
      exp: START / 1000 + 600,
    });

    for (const reachable of [true, false]) {
      access.setReachable(reachable);
      reads = 0;
      for (let second = 0; second < 10; second++) {
        await gate.check(stranger, START + (reachable ? 0 : 60_000) + second * 1_000);
      }
      expect(reads, reachable ? "reachable" : "unreachable").toBe(1);
    }
  });

  test("keys read an hour ago are read again before they are trusted, so a withdrawn key stops working", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    const token = await access.sign(START);
    expect(await gate.check(token, START)).toBe("signed_in");

    await access.rotate({ withdraw: true });

    expect(await gate.check(token, START + 59 * 60_000)).toBe("signed_in");
    expect(await gate.check(token, START + 60 * 60_000)).toBe("signed_out");
  });

  test("keys that cannot be read again after an hour are not trusted", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    const token = await access.sign(START);
    expect(await gate.check(token, START)).toBe("signed_in");

    access.setReachable(false);

    expect(await gate.check(token, START + 60 * 60_000)).toBe("unavailable");
  });

  test("a team domain configured with a trailing slash is the same team", async () => {
    const access = await fakeAccess(APPLICATION);
    const slashed = { ...APPLICATION, teamDomain: `${APPLICATION.teamDomain}/` };

    expect(
      await new AccessGate(access.setup({ application: slashed })).check(
        await access.sign(START),
        START,
      ),
    ).toBe("signed_in");
  });

  test("the keys once read keep the person signed in while the key set cannot be reached", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    const token = await access.sign(START);
    expect(await gate.check(token, START)).toBe("signed_in");

    access.setReachable(false);

    expect(await gate.check(token, START + 60_000)).toBe("signed_in");
  });

  test("a gate that has never read the keys is unavailable while they cannot be reached", async () => {
    const access = await fakeAccess(APPLICATION);
    access.setReachable(false);

    expect(await new AccessGate(access.setup()).check(await access.sign(START), START)).toBe(
      "unavailable",
    );
  });

  test("a token Access signed is the person's only when it carries the person's address", async () => {
    const access = await fakeAccess(APPLICATION);
    const gate = new AccessGate(access.setup());
    const carrying = (email: unknown) => access.sign(START, { email });

    expect(await gate.check(await carrying(THE_PERSONS_EMAIL), START)).toBe("signed_in");
    expect(await gate.check(await carrying(` ${THE_PERSONS_EMAIL.toUpperCase()} `), START)).toBe(
      "signed_in",
    );
    expect(await gate.check(await carrying(SOMEONE_ELSES_EMAIL), START)).toBe("other");
    for (const none of [undefined, "", " ", 42]) {
      expect(await gate.check(await carrying(none), START), String(none)).toBe("none");
    }
    expect(
      await new AccessGate(access.setup({ signInEmail: " " })).check(
        await carrying(THE_PERSONS_EMAIL),
        START,
      ),
    ).toBe("unset");
  });

  test("a Deployment that names no Access application lets nothing in", async () => {
    const access = await fakeAccess(APPLICATION);
    const token = await access.sign(START);

    for (const unnamed of [
      { ...APPLICATION, audience: "" },
      { ...APPLICATION, teamDomain: "" },
    ]) {
      expect(
        await new AccessGate(access.setup({ application: unnamed })).check(token, START),
      ).not.toBe("signed_in");
    }
  });
});
