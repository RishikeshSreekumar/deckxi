/**
 * The Phase 9 exit test: two browsers create a room, switch it to Squad
 * Draft, draft 13 cards each by tapping picks, build XIs (one by hand, one
 * with Auto XI), watch the matches play out, and land on the results screen
 * with a league table — then rematch back to the lobby.
 */
import { devices, expect, test, type Page } from "@playwright/test";

const SHOTS = process.env["SQUAD_SHOTS"];

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** Tap the first legal pick if this page is on the clock. */
async function maybePick(page: Page): Promise<boolean> {
  const pick = page.locator("[data-testid^='pick-']:enabled").first();
  if (await pick.isVisible().catch(() => false)) {
    await pick.click({ timeout: 2000 }).catch(() => undefined);
    return true;
  }
  return false;
}

test("two browsers draft squads, name XIs and play the league", async ({ browser }) => {
  const hostContext = await browser.newContext();
  // The guest plays on a phone: the draft board must work at 390px.
  const guestContext = await browser.newContext({ ...devices["iPhone 13"] });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto("/");
  await host.getByPlaceholder("e.g. CoverDrive").fill("Hosty");
  await host.getByRole("button", { name: "Create table" }).click();
  await expect(host.locator(".lobby-code")).toBeVisible();
  const code = (await host.locator(".lobby-code").innerText()).replace(/\s+/g, "");

  // Switch the room to Squad Draft; the trumps-only rows disappear.
  await host.getByRole("button", { name: "Deck rules" }).click();
  await host.getByTestId("mode-squad-draft").click();
  await expect(host.getByTestId("mode-squad-draft")).toHaveAttribute("aria-checked", "true");
  await expect(host.getByText("Cards per player")).toHaveCount(0);
  await host.locator(".setting-row select").first().selectOption("10");
  await host.getByRole("button", { name: "Done" }).click();
  await expect(host.locator(".lobby-rules-line")).toContainText("Squad draft");

  await guest.goto(`/join/${code}`);
  await guest.getByPlaceholder("e.g. CoverDrive").fill("Guesty");
  await guest.getByRole("button", { name: "Join table" }).click();
  await expect(guest.locator(".lobby-code")).toBeVisible();
  await expect(guest.locator(".lobby-rules-line")).toContainText("Squad draft");

  await host.getByRole("button", { name: "I'm ready" }).click();
  await guest.getByRole("button", { name: "I'm ready" }).click();
  await host.getByRole("button", { name: "Start match" }).click();

  await expect(host.getByTestId("game-table")).toHaveAttribute("data-mode", "squad-draft");
  await expect(guest.getByTestId("game-table")).toHaveAttribute("data-mode", "squad-draft");
  await expect(host.getByTestId("round-chip")).toContainText("Pick 1 of 26");
  await expect(guest.getByTestId("pool")).toBeVisible();
  await shot(guest, "draft-phone");
  await shot(host, "draft-desktop");

  // Draft: whoever is on the clock taps their first legal pick. The turn
  // timer (10s) backstops any pick a page misses.
  const draftDeadline = Date.now() + 120_000;
  let picked = 0;
  while (Date.now() < draftDeadline) {
    const building =
      (await host
        .getByTestId("roster-builder")
        .isVisible()
        .catch(() => false)) ||
      (await host
        .getByTestId("roster-done")
        .isVisible()
        .catch(() => false));
    if (building) break;
    if (await maybePick(host)) picked++;
    if (await maybePick(guest)) picked++;
    await host.waitForTimeout(250);
  }
  expect(picked).toBeGreaterThan(5);
  await expect(host.getByTestId("round-chip")).toContainText("Team sheets");
  await shot(guest, "build-phone");

  // Host builds by hand: eleven "+ XI" taps, five bowlers, one keeper.
  const adds = host.locator("[data-testid^='xi-add-']");
  for (let i = 0; i < 11; i++) await adds.first().click();
  const rows = host.locator(".xi-row");
  await expect(rows).toHaveCount(11);
  for (let i = 0; i < 5; i++) await rows.nth(i).getByTitle("Bowls").click();
  await rows.nth(0).locator(".xi-toggle").nth(1).click();
  await expect(host.getByTestId("submit-xi")).toBeEnabled();
  await shot(host, "build-desktop");
  await host.getByTestId("submit-xi").click();
  await expect(host.getByTestId("roster-done")).toBeVisible();

  // Guest takes the auto XI.
  await guest.getByTestId("auto-xi").click();
  await expect(guest.getByTestId("submit-xi")).toBeEnabled();
  await guest.getByTestId("submit-xi").click();

  // The reveal plays the match phase by phase on both sides, then the table.
  await expect(host.getByTestId("squad-reveal")).toBeVisible();
  await expect(guest.getByTestId("match-card")).toBeVisible();
  await shot(guest, "reveal-phone");
  await expect(host.getByTestId("league-table")).toBeVisible({ timeout: 20_000 });
  await shot(host, "table-desktop");

  await expect(host.getByTestId("results")).toBeVisible({ timeout: 20_000 });
  await expect(guest.getByTestId("results")).toBeVisible({ timeout: 20_000 });
  await expect(host.getByTestId("league-table")).toBeVisible();
  await shot(guest, "results-phone");
  const hostLine = (await host.getByTestId("winner-line").innerText()).toLowerCase();
  const guestLine = (await guest.getByTestId("winner-line").innerText()).toLowerCase();
  expect([hostLine, guestLine]).toContain("you win!");

  await host.getByTestId("rematch").click();
  await expect(host.getByRole("button", { name: "I'm ready" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "I'm ready" })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
