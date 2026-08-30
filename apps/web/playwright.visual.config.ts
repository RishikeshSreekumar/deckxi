/**
 * Visual regression. Needs only the built SPA — no game server — so it stays
 * fast enough to run on every design change.
 *
 * Two suites:
 *   cards.spec.ts   — the /cards gallery: sizes, states, rarities, the full
 *                     edition grid and the OG share composition.
 *   screens.spec.ts — lobby, game table (turn and reveal) and results, seeded
 *                     deterministically from src/dev/visualFixtures.ts. The
 *                     build sets VITE_VISUAL=1 to enable that seam.
 *
 * Viewports are projects. The gallery is viewport-insensitive by nature and
 * expensive to diff, so it runs on desktop and one phone; the app screens run
 * everywhere, because that is where a mobile-first layout can break.
 *
 * Baselines are per-platform and only darwin is committed — see
 * docs/design/visual-regression.md for why, and for how to refresh them.
 */
import { defineConfig, devices } from "@playwright/test";

const SCREENS = /screens\.spec\.ts/;

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
    // Pinned rather than inherited: the token CSS answers prefers-color-scheme
    // now, so an unpinned scheme would make every baseline depend on the
    // machine's OS setting. Specs opt into light explicitly.
    colorScheme: "dark",
  },
  projects: [
    {
      // Small Android-class phone — the tightest layout we support.
      name: "phone-sm",
      use: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 },
      testMatch: SCREENS,
    },
    {
      // Notched iPhone class. We take the device's metrics, not its engine —
      // one browser across every project keeps the baselines comparable.
      name: "phone",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
        isMobile: false,
        deviceScaleFactor: 1,
      },
    },
    {
      // Phone turned sideways — the table's other layout, and the case the
      // old single landscape rule never actually fitted.
      name: "phone-landscape",
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 },
      testMatch: SCREENS,
    },
    {
      name: "tablet",
      use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1 },
      testMatch: SCREENS,
    },
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command:
      "VITE_VISUAL=1 pnpm exec vite build && pnpm exec vite preview --port 4273 --strictPort",
    url: "http://localhost:4273",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
