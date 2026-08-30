/**
 * Card image export pipeline — renders every card in the edition to a
 * 1200×630 share/og PNG by screenshotting the /cards/share/:id route of the
 * built SPA. Reusing the live TrumpCard means exports can never drift from
 * the in-game card.
 *
 * Usage: pnpm --filter @deckxi/web export:cards [outDir]
 * (Runs `vite build` first if dist/ is missing.)
 */
import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const edition = require("@deckxi/data/editions/edition-2026-q3.json");
const outDir = resolve(process.argv[2] ?? join(webRoot, "exports", "cards", edition.id));
const PORT = 4391;

if (!existsSync(join(webRoot, "dist", "index.html"))) {
  console.log("dist/ missing — building the SPA first…");
  execSync("pnpm exec vite build", { cwd: webRoot, stdio: "inherit" });
}
mkdirSync(outDir, { recursive: true });

const preview = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: webRoot,
  stdio: "ignore",
});

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`preview server never came up at ${url}`);
}

try {
  await waitForServer(`http://localhost:${PORT}/`);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    reducedMotion: "reduce", // freeze the legend sheen for deterministic pixels
    // Pinned, not inherited: the app honours prefers-color-scheme now, and a
    // share image must be the product's default look rather than whatever the
    // machine that ran the export happened to be set to.
    colorScheme: "dark",
  });

  for (const player of edition.players) {
    await page.goto(`http://localhost:${PORT}/cards/share/${player.id}`);
    await page.getByTestId("share-frame").waitFor();
    await page.getByTestId("share-frame").screenshot({ path: join(outDir, `${player.id}.png`) });
    console.log(`✓ ${player.id}`);
  }

  await browser.close();
  console.log(`\nExported ${edition.players.length} cards to ${outDir}`);
} finally {
  preview.kill();
}
