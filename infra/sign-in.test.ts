import { describe, expect, test } from "bun:test";
import { signInRefusal } from "./sign-in.ts";

describe("who a deploy lets sign in", () => {
  test("may be one Google address", () => {
    expect(signInRefusal({ signInEmail: "person@example.com", lettingInMore: [] })).toBeNull();
  });

  test("is refused when no address is named, saying which setting to give and how", () => {
    for (const signInEmail of [undefined, "", "  "]) {
      const refusal = signInRefusal({ signInEmail, lettingInMore: [] });
      expect(refusal).toContain("praxis:signInEmail");
      expect(refusal).toContain("pulumi env edit");
    }
  });

  test("is refused when it is not one address, such as a domain or a list", () => {
    for (const signInEmail of [
      "example.com",
      "@example.com",
      "person@",
      "a@example.com, b@example.com",
      "a@b@example.com",
    ]) {
      expect(signInRefusal({ signInEmail, lettingInMore: [] }), signInEmail).toContain(
        "one Google address",
      );
    }
  });

  test("is refused while a setting that let in more than the person is left, naming it", () => {
    const refusal = signInRefusal({
      signInEmail: "person@example.com",
      lettingInMore: ["allowedEmails", "allowedEmailDomain"],
    });

    expect(refusal).toContain("praxis:allowedEmails");
    expect(refusal).toContain("praxis:allowedEmailDomain");
    expect(refusal).toContain("pulumi env edit");
  });
});
