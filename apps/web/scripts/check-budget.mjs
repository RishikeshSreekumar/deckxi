/**
 * Mobile performance budget gate (#107).
 *
 * Measures what a first-time visitor on a phone actually downloads before the
 * app can render: the entry module, everything index.html tells the browser to
 * preload alongside it, and the stylesheet. Route chunks that load later
 * (profile, history, privacy, the gallery, qrcode) are deliberately excluded —
 * splitting them out is the point.
 *
 * Sizes are gzipped, because that is what crosses the network. Brotli would be
 * kinder still, but gzip is the floor every CDN gives us and budgeting against
 * the floor is the honest choice.
 *
 *   pnpm --filter @deckxi/web budget          report
 *   pnpm --filter @deckxi/web budget:check    fail if over (runs in CI)
 *
 * A bundle gate, not Lighthouse. Lighthouse numbers on shared CI runners move
 * several hundred milliseconds run to run, which makes a threshold either
 * meaningless or flaky. Payload is deterministic, and payload is what actually
 * regresses when a redesign adds weight. Field-side targets (LCP, INP on a
 * mid-tier Android over 4G) live in docs/design/performance.md and are checked
 * by hand before a release.
 */
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(webRoot, "dist");
const budget = JSON.parse(readFileSync(join(webRoot, "performance-budget.json"), "utf8"));

const html = readFileSync(join(dist, "index.html"), "utf8");

/** Assets index.html asks for up front: the entry, its preloads, its CSS. */
function initialAssets() {
  const js = new Set();
  const css = new Set();
  for (const [, attrs] of html.matchAll(/<(?:script|link)\s([^>]*)>/g)) {
    const href = /(?:src|href)="([^"]+)"/.exec(attrs)?.[1];
    if (href === undefined || !href.startsWith("/assets/")) continue;
    if (href.endsWith(".css")) css.add(href);
    else if (/rel="modulepreload"|type="module"/.test(attrs)) js.add(href);
  }
  return { js: [...js], css: [...css] };
}

const gzipped = (href) => gzipSync(readFileSync(join(dist, href.slice(1)))).length;
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const { js, css } = initialAssets();
if (js.length === 0)
  throw new Error("No entry script found in dist/index.html — did the build run?");

const measured = {
  "initial-js-gzip-kb": kb(js.reduce((sum, href) => sum + gzipped(href), 0)),
  "initial-css-gzip-kb": kb(css.reduce((sum, href) => sum + gzipped(href), 0)),
  "initial-requests": js.length + css.length,
};

const rows = Object.entries(budget.budgets).map(([key, limit]) => ({
  key,
  limit,
  actual: measured[key],
  over: measured[key] > limit,
}));

const width = Math.max(...rows.map((r) => r.key.length));
console.log("Initial payload (gzipped, first render):\n");
for (const href of [...js, ...css]) console.log(`  ${href}  ${kb(gzipped(href))} kB`);
console.log("");
for (const row of rows) {
  const verdict = row.over ? "OVER BUDGET" : "ok";
  console.log(`  ${row.key.padEnd(width)}  ${row.actual} / ${row.limit}  ${verdict}`);
}

const over = rows.filter((r) => r.over);
if (over.length > 0 && process.argv.includes("--check")) {
  console.error(
    `\n${over.length} budget(s) exceeded. Either split the weight out of the initial ` +
      `chunk, or raise the budget in performance-budget.json with a reason in the commit ` +
      `message — but raising it should be a decision, not a reflex.`,
  );
  process.exit(1);
}
