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
