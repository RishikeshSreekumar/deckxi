/**
 * Screenshot the app screens the redesign touches — lobby, game table (your
 * turn and mid-reveal) and results — at every viewport project. The theme is
 * pinned to light for now (src/lib/theme.ts), so there is one baseline each.
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

/** Opened rather than seeded: the drawer's state lives in the component. */
const OPEN_CHAT = "table-chat";

async function seed(page: Page, scenario: string, ready: string) {
  await page.goto(`/__visual/${scenario}`);
  await expect(page.getByTestId(ready)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The in-game chat drawer restyled onto v2 tokens during the redesign and had
 * no visual coverage of its own — the one component whose every colour changed
 * with nothing watching.
 */
test(OPEN_CHAT, async ({ page }) => {
  await seed(page, "table-turn", "game-table");
  await page.getByTestId("game-chat").getByRole("button").first().click();
  // Park the pointer so no baseline photographs a hover state.
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(`${OPEN_CHAT}.png`);
});

for (const scenario of SCENARIOS) {
  test(scenario.name, async ({ page }) => {
    await seed(page, scenario.path, scenario.ready);
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(`${scenario.name}.png`);
  });
}
