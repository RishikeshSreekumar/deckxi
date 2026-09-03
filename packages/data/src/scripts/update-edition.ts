/**
 * Synthetic edition refresh: applies form drift to an edition and writes it
 * back in place (same edition id, version +1).
 *
 *   pnpm --filter @deckxi/data update-edition [--edition <id>] [--seed <n>]
 *
 * Drift is invented movement, so it only makes sense for invented data. An
 * edition derived from real sources (it declares `sources`) is refused —
 * refresh those with `import-cricsheet`, which re-derives every number.
 *
 * The seed defaults to the current UTC date (YYYYMMDD), so re-runs on the
 * same day are idempotent and the PR is reproducible.
 */
import { writeFileSync } from "node:fs";
import { CURRENT_EDITION_ID, editionPath, loadEdition } from "../editions.js";
import { driftEdition, topMovers } from "../drift.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const editionId = arg("edition") ?? CURRENT_EDITION_ID;
const now = new Date();
const defaultSeed = Number(
  `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`,
);
const seed = Number(arg("seed") ?? defaultSeed);
const generatedAt = now.toISOString().replace(/\.\d+Z$/, "Z");

const before = loadEdition(editionId);
if (before.sources !== undefined) {
  console.error(
    `${editionId} is derived from real data (${before.sources.map((s) => s.name).join(", ")}); ` +
      "run import-cricsheet to refresh it instead of drifting it.",
  );
  process.exit(1);
}
const { edition: after } = driftEdition(before, seed, generatedAt);
writeFileSync(editionPath(editionId), JSON.stringify(after, null, 2) + "\n");

console.log(`${editionId}: v${before.version} → v${after.version} (seed ${seed})`);
console.log("Top movers by rating:");
for (const m of topMovers(before, after)) {
  console.log(`  ${m.delta > 0 ? "+" : ""}${m.delta}  ${m.name}`);
}
