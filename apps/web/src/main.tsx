/**
 * @deckxi/web — React SPA (Vite) for playing DeckXI in the browser.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initSocket } from "./store/store.js";
import { ensureSession } from "./lib/auth.js";
import { initTheme } from "./lib/theme.js";
import { initErrorReporting } from "./lib/errors.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { applyVisualFixture } from "./dev/visualFixtures.js";
import "@deckxi/ui/styles.css";
import "./styles.css";

// Before the tree renders, so the toggle and the status-bar tint agree with
// what the token CSS already painted.
initTheme();

// Before anything else can throw: async errors and rejected promises are
// invisible to React's boundary, and those are most of them (#64).
initErrorReporting();

// Visual-regression builds (VITE_VISUAL=1) can seed a deterministic screen
// from the URL and skip the network entirely, so no screenshot catches a
// connection banner. Normal builds never include the fixtures module.
const seeded = import.meta.env.VITE_VISUAL === "1" && applyVisualFixture();

if (!seeded) {
  // Identity first (guest session cookie), then connect — the socket
  // handshake reads the cookie to know who's behind the connection.
  void ensureSession().finally(initSocket);
}

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root element");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
