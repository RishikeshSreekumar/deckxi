/**
 * Visual regression against the /cards gallery. Needs only the built SPA —
 * no game server — so it stays fast enough to run on every design change.
 * Baselines are per-platform; refresh with `pnpm test:visual --update-snapshots`.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-visual",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" },
  },
  retries: 0,
  use: {
    baseURL: "http://localhost:4273",
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 4273 --strictPort",
    url: "http://localhost:4273",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
