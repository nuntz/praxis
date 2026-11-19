// Making the Web Push signing key pair, apart from the sender, so the setup wizard's script runs it
// under Bun as the tests run it in workerd: it needs nothing but Web Crypto.

/**
 * A new signing key pair for the Deployment, as the setup wizard makes it once (section 12): the
 * public key raw and base64url, as a browser subscribes with it, and the private key as a JWK.
 * A new pair orphans every subscription made for the old one.
 */
export async function makePushKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  const { kty, crv, x, y, d } = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  let binary = "";
  for (const byte of new Uint8Array(raw)) binary += String.fromCharCode(byte);
  const publicKey = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return { publicKey, privateKey: JSON.stringify({ kty, crv, x, y, d }) };
}
