import { render } from "solid-js/web";
import { Journal } from "./Journal.tsx";
import "./styles.css";

render(
  () => (
    <main class="main-screen">
      <Journal />
    </main>
  ),
  document.body,
);
