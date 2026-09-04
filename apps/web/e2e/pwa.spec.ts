/**
 * PWA lifecycle checks (#109, #110).
 *
 * The two things worth automating here are the ones that fail silently: an
 * install that is not actually installable, and a service worker that
 * intercepts gameplay traffic. The second is the dangerous one — a cached ack
 * looks exactly like a server bug, and by the time anyone diagnoses it the
 * bad worker is on everyone's phone.
 */
import { test, expect, type Page } from "@playwright/test";

/**
 * Wait until the worker actually controls the page. It does not on first
 * load, and that is the point: `registerType: "prompt"` means a new worker
 * waits rather than seizing the page out from under a game in progress. One
 * reload later it is in charge.
 */
async function serviceWorkerInControl(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
}

test("manifest is served and describes an installable app", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).not.toBeNull();

  const manifest = await (await request.get(href ?? "")).json();
  expect(manifest.name).toContain("DeckXI");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");

  // Chrome's installability bar: a 192 and a 512, and a maskable variant or
  // Android letterboxes the icon into a white square.
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).status(), `${icon.src} should exist`).toBe(200);
  }
});

test("identity assets are served", async ({ request }) => {
  for (const path of ["/icon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-default.png"]) {
    expect((await request.get(path)).status(), `${path} should exist`).toBe(200);
  }
});

test("the service worker registers and leaves a deep link working", async ({ page }) => {
  await page.goto("/");
  await serviceWorkerInControl(page);

  // The SPA fallback must survive the worker: an invite link is how most
  // players arrive, and it is a route that only exists client-side.
  await page.goto("/join/ABCDEF");
  await expect(page.getByRole("heading", { name: /Start playing/ })).toBeVisible();
});

test("gameplay traffic is never served from the cache", async ({ page }) => {
  await page.goto("/");
  await serviceWorkerInControl(page);

  // Play far enough to generate socket traffic, then interrogate every cache
  // the worker owns. Nothing that carries game state may be in any of them.
  await page.getByLabel(/name/i).first().fill("Cache Check");
  await page.getByRole("button", { name: /create table/i }).click();
  await expect(page.getByTestId("lobby-screen")).toBeVisible();

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });

  const leaked = cached.filter((url) => /\/socket\.io\/|\/api\/|\/auth\//.test(url));
  expect(leaked, "no gameplay or auth request may be cached").toEqual([]);
});

test("the manifest's create-room shortcut hosts a table", async ({ page }) => {
  // The shortcut is the one manifest entry that carries behaviour: `/?new=1`
  // must actually seat you at a fresh table, not drop you on the landing page
  // with the same two choices you took the shortcut to skip.
  await page.goto("/");
  await page.getByLabel(/name/i).first().fill("Shortcut Host");

  await page.goto("/?new=1");
  await expect(page.getByTestId("lobby-screen")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("practice plays a round with the network cut", async ({ page, context }) => {
  // The install story is only half of #85: the other half is that there is
  // something to do once you are offline. Practice runs the engine on the
  // device, so a cut network must not stop a round from resolving.
  await page.goto("/");
  await serviceWorkerInControl(page);
  await page.getByPlaceholder("e.g. CoverDrive").first().fill("Tunnel Player");

  await context.setOffline(true);
  await page.getByTestId("practice").click();
  await expect(page.getByTestId("game-table")).toBeVisible();
  // The offline banner belongs to rooms, not to a game played on the device.
  await expect(page.getByTestId("conn-banner")).toHaveCount(0);

  // Whoever leads, the round resolves on the device: bots move in the same
  // burst, so either a reveal is already animating or the pick is ours.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (
      await page
        .getByTestId("reveal-cards")
        .isVisible()
        .catch(() => false)
    )
      break;
    const stat = page.locator(".your-area--turn .stat-button").first();
    if (await stat.isVisible().catch(() => false)) {
      await stat.click({ timeout: 2000 }).catch(() => undefined);
    }
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId("reveal-cards")).toBeVisible();

  await context.setOffline(false);
});
