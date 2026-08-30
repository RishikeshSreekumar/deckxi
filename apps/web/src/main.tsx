/**
 * @deckxi/web — React SPA (Vite) for playing DeckXI in the browser.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initSocket } from "./store/store.js";
import { ensureSession } from "./lib/auth.js";
import { initTheme } from "./lib/theme.js";
import "@deckxi/ui/styles.css";
import "./styles.css";

// Before the tree renders, so the toggle and the status-bar tint agree with
// what the token CSS already painted.
initTheme();

// Identity first (guest session cookie), then connect — the socket handshake
// reads the cookie to know who's behind the connection.
void ensureSession().finally(initSocket);

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
