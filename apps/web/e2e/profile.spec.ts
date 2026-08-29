/**
 * Phase 6 exit test: a fresh visitor gets a guest identity (cricket handle +
 * avatar) automatically, can rename themselves and change avatar on the
 * profile page, and can read the privacy page and empty match history.
 */
import { expect, test } from "@playwright/test";

test("guest identity, profile editing, history and privacy pages", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Landing: the guest session fills the name field with a generated handle
  // and the profile chip shows it.
  await page.goto("/");
  const nameInput = page.getByPlaceholder("e.g. CoverDrive");
  await expect(nameInput).not.toHaveValue("", { timeout: 10_000 });
  const handle = await nameInput.inputValue();
  expect(handle).toMatch(/^[A-Za-z]+\d{1,2}$/);
  await expect(page.locator(".profile-chip")).toContainText(handle);

  // Profile: same identity, editable display name.
  await page.locator(".profile-chip").click();
  await expect(page.getByLabel("Display name")).toHaveValue(handle);
  await expect(page.getByText("Playing as a guest on this device.")).toBeVisible();
  await page.getByLabel("Display name").fill("SwitchHit99");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  // Avatar picker: choose a specific avatar.
  await page.getByRole("button", { name: "Change avatar" }).click();
  await page.locator(".avatar-choice", { hasText: "🏆" }).click();
  await expect(page.locator(".avatar-button .avatar")).toContainText("🏆");

  // The rename + avatar survive a reload (cookie-backed identity).
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("SwitchHit99");
  await expect(page.locator(".avatar-button .avatar")).toContainText("🏆");

  // Empty match history state.
  await page.getByRole("link", { name: "Match history" }).click();
  await expect(page.getByText("No matches yet")).toBeVisible();

  // Privacy page.
  await page.goto("/privacy");
  await expect(page.getByText("What we store")).toBeVisible();
  await expect(page.getByText("Deleting your data")).toBeVisible();

  await context.close();
});
