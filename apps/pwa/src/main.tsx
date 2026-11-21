import { render } from "solid-js/web";
import "@fontsource-variable/figtree/wght.css";
import "@fontsource-variable/figtree/wght-italic.css";
import "virtual:tokens.css";
import { App } from "./App.tsx";
import "./styles.css";

render(() => <App />, document.body);

// The service worker keeps the screen, so Praxis opens with no network, and shows a Notification
// and opens what a tap names (sw.js). Without it Praxis works the same with the network, with no
// Notifications on this Device.
navigator.serviceWorker?.register("/sw.js").catch(() => {});
