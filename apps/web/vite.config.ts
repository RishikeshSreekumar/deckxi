/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The service worker is the highest-risk part of the PWA: done wrong, players
 * get a stale app they cannot escape without clearing site data, and DeckXI
 * has a constraint most PWAs do not — a live Socket.IO connection that must
 * never be intercepted.
 *
 * Three rules encode that:
 *   1. Precache only our own hashed build output and static identity assets.
 *   2. Every route that carries gameplay is NetworkOnly, declared explicitly
 *      rather than left to fall through. The polling transport issues real
 *      HTTP requests that a naive NetworkFirst would happily cache, and a
 *      cached ack looks exactly like a server bug.
 *   3. Updates are offered, never forced — `registerType: "prompt"`. See
 *      UpdatePrompt in components/Chrome.tsx, which additionally refuses to
 *      reload while the player is in a room.
 *
 * Kill switch: if a bad worker reaches production, set `selfDestroying: true`
 * here and ship. The plugin then emits a worker whose only job is to
 * unregister itself and drop its caches. See docs/design/pwa.md.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Visual-regression builds turn the worker off: a service worker
      // caching the shell between screenshot runs is a source of stale
      // pixels, and none of the baselines are about the worker.
      disable: process.env["VITE_VISUAL"] === "1",
      registerType: "prompt",
      includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "DeckXI — cricket trump cards",
        short_name: "DeckXI",
        description: "Cricket trump cards, live with friends.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // The game table has a real landscape layout, so we never lock the
        // player out of turning the phone.
        orientation: "any",
        background_color: "#241b16",
        theme_color: "#241b16",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Create a room",
            short_name: "New room",
            url: "/?new=1",
            icons: [{ src: "/icon-192.png", sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // A cold start with no network serves the precached shell, which then
        // renders the app's own offline state. That beats a separate
        // offline.html: one less thing to keep in step with the design, and
        // the player lands somewhere they can act rather than a dead end.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            // Gameplay: both transports, both origins. Never cached, never
            // deferred, no exceptions.
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/socket.io/") ||
              url.pathname.startsWith("/api/") ||
              url.pathname.startsWith("/auth/"),
            handler: "NetworkOnly",
          },
          {
            // Exported card art: worth keeping for repeat visits, capped so a
            // long-lived install cannot grow without bound.
            urlPattern: ({ request, url }) =>
              request.destination === "image" && url.origin === self.location.origin,
            handler: "CacheFirst",
            options: {
              cacheName: "deckxi-images",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        // Off by default: a service worker in dev turns every stale-asset
        // question into a cache question. Flip it on deliberately when
        // working on the worker itself.
        enabled: false,
      },
    }),
  ],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    // "hidden": maps are emitted but no `//# sourceMappingURL` comment points
    // at them, so nothing fetches them in a browser. CI keeps them as a build
    // artifact and deletes them before publishing (#64) — a minified stack in
    // a client error report is only useful if the map for that exact release
    // still exists somewhere, and "somewhere" is the workflow run, not a
    // public URL.
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        // Routes that are not part of getting into a game are split out of the
        // initial chunk (#107). qrcode is lobby-only and rides along with it.
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          socket: ["socket.io-client"],
        },
      },
    },
  },
  test: {
    // Unit tests only — e2e/ belongs to Playwright.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
