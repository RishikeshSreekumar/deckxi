/**
 * Screenshot the app screens the redesign touches — lobby, game table (your
 * turn and mid-reveal) and results — in both themes, at every viewport
 * project.
 *
 * State comes from src/dev/visualFixtures.ts via /__visual/<scenario>, not
 * from a live server: the fixtures are literal, so a diff here is a design
 * change and never a shuffle or a clock. The fixture rewrites the URL to "/"
 * and the app routes from the seeded store exactly as it would in a game.
 */
import { test, expect, type Page } from "@playwright/test";

const SCENARIOS = [
  { name: "lobby", path: "lobby", ready: "lobby-screen" },
  { name: "table-turn", path: "table-turn", ready: "game-table" },
  { name: "table-reveal", path: "table-reveal", ready: "verdict" },
  { name: "results", path: "results", ready: "results" },
] as const;

async function seed(page: Page, scenario: string, ready: string) {
  await page.goto(`/__visual/${scenario}`);
  await expect(page.getByTestId(ready)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const scenario of SCENARIOS) {
  test(`${scenario.name} — dark`, async ({ page }) => {
    await seed(page, scenario.path, scenario.ready);
    await expect(page).toHaveScreenshot(`${scenario.name}-dark.png`);
  });

  test(`${scenario.name} — light`, async ({ page }) => {
    await seed(page, scenario.path, scenario.ready);
    // Through the real toggle, so the screenshot proves the in-app control
    // works and not merely that the CSS has a light block.
    await page.getByTestId("theme-toggle").first().click();
    // Park the pointer: otherwise every light baseline also photographs the
    // toggle's hover state and dark's does not.
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(`${scenario.name}-light.png`);
  });
}
