/**
 * #139: a host alone in their own room seats bots and plays a real game —
 * the server's rules and the server's timers.
 */
import { expect, test } from "@playwright/test";

test("the host fills the table with bots and plays", async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage();

  await host.goto("/");
  await host.getByPlaceholder("e.g. CoverDrive").fill("Hosty");
  await host.getByRole("button", { name: "Create table" }).click();
  await expect(host.locator(".lobby-code")).toBeVisible();

  // Short game so the test finishes: 3 cards each, 10-round cap.
  await host.getByRole("button", { name: "Match settings" }).click();
  await host.locator(".setting-row select").nth(0).selectOption("3");
  await host.locator(".setting-row select").nth(2).selectOption("10");
  await host.getByRole("button", { name: "Done" }).click();

  await host.getByTestId("add-bot").click();
  await host.getByTestId("add-bot").click();
  await expect(host.locator(".player-list li", { hasText: "(bot)" })).toHaveCount(2);
  await expect(host.locator(".player-list")).toContainText("never bluffs");

  // A bot's seat is the host's to free again.
  await host.locator("[data-testid^='remove-bot-']").first().click();
  await expect(host.locator(".player-list li", { hasText: "(bot)" })).toHaveCount(1);

  await host.getByTestId("add-bot").click();
  await expect(host.locator(".player-list li", { hasText: "(bot)" })).toHaveCount(2);
  await host.getByRole("button", { name: "I'm ready" }).click();
  await host.getByRole("button", { name: "Start match" }).click();
  await expect(host.getByTestId("game-table")).toBeVisible();

  // The bots move on their own; the human only has to answer their own calls.
  for (let i = 0; i < 60; i++) {
    if (
      await host
        .getByTestId("results")
        .isVisible()
        .catch(() => false)
    )
      break;
    const stat = host.locator(".your-area--turn .stat-button").first();
    if (await stat.isVisible().catch(() => false)) {
      await stat.click({ timeout: 2000 }).catch(() => undefined);
      const call = host.getByTestId("call-stat");
      if (await call.isEnabled().catch(() => false)) {
        await call.click({ timeout: 2000 }).catch(() => undefined);
      }
    }
    await host.waitForTimeout(500);
  }
  await expect(host.getByTestId("results")).toBeVisible({ timeout: 60_000 });

  await context.close();
});
