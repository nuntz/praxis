import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** A real Access application to run the key set's contract against, when given by hand. */
    realAccess: { teamDomain: string; audience: string; token: string } | null;
  }
}
