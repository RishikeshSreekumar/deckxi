/**
 * The Phase 5 exit test: two headless browsers create a room, join by invite
 * code, ready up, and play a complete game of Classic Trumps to the results
 * screen — then rematch back to the lobby.
 */
import { expect, test, type Page } from "@playwright/test";

async function readRoomCode(page: Page): Promise<string> {
  const code = (await page.locator(".room-code").innerText()).replace(/\s+/g, "");
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  return code;
}

/** Click a stat if this page's player currently has the pick. */
async function maybePick(page: Page): Promise<void> {
  const stat = page.locator(".your-area--turn .stat-button").first();
  if (await stat.isVisible().catch(() => false)) {
    await stat.click({ timeout: 2000 }).catch(() => undefined);
  }
}

test("two browsers play a full game", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  // Host creates a room.
  await host.goto("/");
  await host.getByPlaceholder("e.g. CoverDrive").fill("Hosty");
  await host.getByRole("button", { name: "Create a room" }).click();
  await expect(host.locator(".room-code")).toBeVisible();
  const code = await readRoomCode(host);

  // Short game: 3 cards each, 10-round cap, quick timer as a safety net.
  await host.locator(".setting-row select").nth(0).selectOption("3");
  await host.locator(".setting-row select").nth(1).selectOption("10");
  await host.locator(".setting-row select").nth(2).selectOption("10");

  // Guest joins via the invite link.
  await guest.goto(`/join/${code}`);
  await guest.getByPlaceholder("e.g. CoverDrive").fill("Guesty");
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await expect(guest.locator(".room-code")).toBeVisible();

  // Both see each other in the lobby.
  await expect(host.locator(".player-list")).toContainText("Guesty");
  await expect(guest.locator(".player-list")).toContainText("Hosty");

  // Ready up and start.
  await host.getByRole("button", { name: "I'm ready" }).click();
  await guest.getByRole("button", { name: "I'm ready" }).click();
  await host.getByRole("button", { name: "Start game" }).click();

  await expect(host.getByTestId("game-table")).toBeVisible();
  await expect(guest.getByTestId("game-table")).toBeVisible();

  // Chat works at the table, not just in the lobby: the host sends, the guest
  // sees an unread badge, and opening the drawer shows the message.
  await host.getByRole("button", { name: "Open chat" }).click();
  await host.getByLabel("Chat message").fill("good luck");
  await host.getByRole("button", { name: "Send" }).click();
  await expect(host.getByTestId("game-chat-log")).toContainText("good luck");

  await guest.getByRole("button", { name: "Open chat, 1 unread" }).click();
  await expect(guest.getByTestId("game-chat-log")).toContainText("Hosty");
  await expect(guest.getByTestId("game-chat-log")).toContainText("good luck");
  await guest.getByRole("button", { name: "Close chat" }).click();
  await host.getByRole("button", { name: "Close chat" }).click();

  // Play until the results screen shows on both sides. Whoever holds the
  // pick clicks their first stat; the reveal animation paces the loop and
  // the server's turn timer backstops any missed pick.
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (
      (await host
        .getByTestId("results")
        .isVisible()
        .catch(() => false)) &&
      (await guest
        .getByTestId("results")
        .isVisible()
        .catch(() => false))
    ) {
      break;
    }
    await maybePick(host);
    await maybePick(guest);
    await host.waitForTimeout(400);
  }

  await expect(host.getByTestId("winner-line")).toBeVisible();
  await expect(guest.getByTestId("winner-line")).toBeVisible();

  // One side sees "You win!", the other sees the winner's name.
  const hostLine = (await host.getByTestId("winner-line").innerText()).toLowerCase();
  const guestLine = (await guest.getByTestId("winner-line").innerText()).toLowerCase();
  expect([hostLine, guestLine]).toContain("you win!");

  // Host starts a rematch: both land back in the lobby, un-readied.
  await host.getByTestId("rematch").click();
  await expect(host.getByRole("button", { name: "I'm ready" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "I'm ready" })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
