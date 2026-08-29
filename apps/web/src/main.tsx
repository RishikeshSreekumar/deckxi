/**
 * @deckxi/web — React SPA (Vite) for playing DeckXI in the browser.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initSocket } from "./store/store.js";
import "./styles.css";

initSocket();

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
