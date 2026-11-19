import { createSignal } from "solid-js";

/**
 * Whether the Device says it has a network, as the browser last said. The whole Conversation
 * needs one (section 8.8): without it the Conversation says so in place of its composer.
 */
const [online, setOnline] = createSignal(typeof navigator === "undefined" || navigator.onLine);

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}

export { online };
