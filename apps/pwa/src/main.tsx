import { render } from "solid-js/web";
import "@fontsource-variable/figtree/wght.css";
import "@fontsource-variable/figtree/wght-italic.css";
import "virtual:tokens.css";
import { App } from "./App.tsx";
import "./styles.css";

render(() => <App />, document.body);

// The service worker shows a Notification and opens what a tap names (public/sw.js). Without it
// Praxis works the same, with no Notifications on this Device.
navigator.serviceWorker?.register("/sw.js").catch(() => {});
