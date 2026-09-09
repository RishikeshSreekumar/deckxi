/**
 * #141: /deck shows each deck — its blurb, its card count, and the cards
 * themselves — and `?deck=` makes one linkable.
 */
import { expect, test } from "@playwright/test";

const DECKS = ["all-stars", "legends", "batters-xi", "bowlers-union"];

test("the deck page shows every deck, and ?deck= restores one", async ({ page }) => {
  await page.goto("/deck");
  await expect(page.getByTestId("deck-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "All Stars" })).toBeVisible();

  for (const id of DECKS) {
    await page.getByTestId(`deck-${id}`).click();
    // The count in the header is the count of cards on the page.
    const header = await page.getByTestId("deck-count").innerText();
    const shown = Number(/^(\d+) of/.exec(header)?.[1]);
    expect(shown).toBeGreaterThan(0);
    await expect(page.getByTestId("deck-grid").locator(".card-scale")).toHaveCount(shown);
  }

  // The chosen deck is in the URL, so it survives a reload.
  await expect(page).toHaveURL(/deck=bowlers-union/);
  await page.reload();
  await expect(page.getByTestId("deck-bowlers-union")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Bowlers' Union" })).toBeVisible();

  // Role and rarity filters cut inside the chosen deck.
  const all = await page.getByTestId("deck-count").innerText();
  await page.getByRole("button", { name: "Legends", exact: true }).click();
  const legends = await page.getByTestId("deck-count").innerText();
  expect(legends).not.toBe(all);
});
