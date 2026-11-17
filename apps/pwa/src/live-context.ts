import { createContext, useContext } from "solid-js";
import type { LiveListener } from "./live.ts";

/** The address of a Context's live channel, a WebSocket on the screen's own origin. */
export function liveAddress(contextId: string): string {
  const address = new URL(`/api/contexts/${encodeURIComponent(contextId)}/live`, location.href);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  return address.href;
}

/** The current Context's live channel, as what is shown inside it hears it. */
export type CurrentLive = {
  listen(listener: LiveListener): () => void;
  /**
   * Settles once what the screen reads would miss nothing the channel brings, or once it has
   * waited long enough for that.
   */
  ready: Promise<void>;
};

export const CurrentContextLive = createContext<CurrentLive>();

export function useLive(): CurrentLive {
  const live = useContext(CurrentContextLive);
  if (!live) throw new Error("Shown outside any Context");
  return live;
}
