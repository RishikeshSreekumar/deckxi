/**
 * E2E setup: a real game server (in-memory store) on :3901 and the built SPA
 * on :4173, then headless browsers play an actual game against each other.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI !== undefined ? 1 : 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: [
    {
      command:
        "pnpm -w exec turbo run build --filter=@deckxi/server && node ../server/dist/index.js",
      url: "http://localhost:3901/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: "3901",
        HOST: "127.0.0.1",
        CORS_ORIGINS: "http://localhost:4173",
      },
    },
    {
      command: "pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: "http://localhost:3901",
      },
    },
  ],
});
