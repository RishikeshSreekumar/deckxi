/**
 * Screenshot the card gallery — sizes/states, rarities (both themes), the
 * full-edition grid, and the share/og composition. Any change to tokens,
 * the TrumpCard, rarity foils or the card back shows up as a diff here.
 */
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const edition = require("@deckxi/data/editions/edition-2026-q3.json") as {
  players: { id: string }[];
};

test.beforeEach(async ({ page }) => {
  await page.goto("/cards");
  await expect(page.getByTestId("cards-gallery")).toBeVisible();
  // Card art is inline SVG + CSS only; fonts are the OS stack. Give layout a beat.
  await page.evaluate(() => document.fonts.ready);
});

test("component kit", async ({ page }) => {
  await expect(page.getByTestId("gallery-kit")).toHaveScreenshot("kit-dark.png");
});

test("component kit — light", async ({ page }) => {
  await page.getByTestId("theme-toggle").click();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId("gallery-kit")).toHaveScreenshot("kit-light.png");
});

test("sizes and states", async ({ page }) => {
  await expect(page.getByTestId("gallery-states")).toHaveScreenshot("states.png");
});

test("rarities — dark", async ({ page }) => {
  await expect(page.getByTestId("gallery-rarities")).toHaveScreenshot("rarities-dark.png");
});

test("rarities — light", async ({ page }) => {
  await page.getByTestId("theme-toggle").click();
  await expect(page.getByTestId("gallery-rarities")).toHaveScreenshot("rarities-light.png");
});

test("full edition grid", async ({ page }) => {
  await expect(page.getByTestId("gallery-all")).toHaveScreenshot("all-cards.png", {
    // 64 cards of text — allow a whisker more antialiasing noise.
    maxDiffPixelRatio: 0.004,
  });
});

test("share composition", async ({ page }) => {
  const first = edition.players[0];
  expect(first).toBeDefined();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(`/cards/share/${first?.id ?? ""}`);
  await expect(page.getByTestId("share-frame")).toHaveScreenshot("share-og.png");
});
