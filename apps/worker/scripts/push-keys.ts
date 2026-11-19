import { makePushKeys } from "../src/push-keys.ts";

// The Web Push signing key pair the setup wizard makes, once, for a Deployment (section 12): the
// public key on the first line, base64url, and the private key as a JWK on the second.
//
//   bun scripts/push-keys.ts
//
// The wizard keeps both in the Deployment's configuration and never makes a second pair: every
// browser's subscription is bound to the public key it was made with.

const { publicKey, privateKey } = await makePushKeys();
console.log(publicKey);
console.log(privateKey);
