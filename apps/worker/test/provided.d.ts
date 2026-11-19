import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** A real Access application to run the key set's contract against, when given by hand. */
    realAccess: { teamDomain: string; audience: string; token: string } | null;
    /** The person's own model key, and optionally the model, when given by hand. */
    realModel: { key: string; model: string } | null;
    /**
     * A real push service to run the sender's contract against, when given by hand: the
     * Deployment's key pair and subject, a subscription a browser made for that key, and one
     * since unsubscribed.
     */
    realPush: {
      publicKey: string;
      privateKey: string;
      subject: string;
      subscription: string;
      gone: string | null;
    } | null;
  }
}
