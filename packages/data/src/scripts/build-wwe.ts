/**
 * Build the WWE edition (#143).
 *
 * Unlike the cricket importer there is no ball-by-ball archive to fold: a
 * wrestling record is a matter of published fact, not derivation, so the
 * numbers are hand-curated in `sources/wrestlers.json` and this script's job
 * is to validate them, resolve a free-licence photograph per card, derive the
 * rating and write the edition file.
 *
 *   pnpm --filter @deckxi/data build-wwe                 # rebuild from cache
 *   pnpm --filter @deckxi/data build-wwe --refresh-people  # re-resolve Wikidata
 *   pnpm --filter @deckxi/data build-wwe --photos          # download + crop
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { editionSchema, type Edition, type Player } from "@deckxi/shared";
import { editionPath } from "../editions.js";
import { regenerateRatings } from "../rating.js";
import { fetchAndCropPhoto, PHOTO_WIDTH } from "../import/photos.js";
import { enrichWrestlers, type WrestlerPerson } from "../wwe/enrich.js";
import {
  WWE_EDITION_ID,
  WWE_ROLES,
  WWE_SOURCES,
  WWE_STATS,
  WWE_POWERS,
  WWE_STAT_GROUPS,
  WWE_TEAMS,
} from "../wwe/config.js";
import { WWE_DECKS } from "../wwe/decks.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourcesDir = join(packageRoot, "sources");
const rosterPath = join(sourcesDir, "wrestlers.json");
const peoplePath = join(sourcesDir, "wrestler-people.json");

const has = (name: string) => process.argv.includes(`--${name}`);

interface RosterEntry {
  id: string;
  name: string;
  teamId: string;
  role: string;
  nationality: string;
  rarity: Player["rarity"];
  stats: Record<string, number>;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

async function main(): Promise<void> {
  const roster = (JSON.parse(readFileSync(rosterPath, "utf8")) as { wrestlers: RosterEntry[] })
    .wrestlers;
  const photoDir = join(packageRoot, "..", "..", "apps", "web", "public", "cards", WWE_EDITION_ID);

  let people = readJson<Record<string, WrestlerPerson>>(peoplePath, {});
  const missing = roster.filter((w) => people[w.name] === undefined).map((w) => w.name);
  if (has("refresh-people") || missing.length > 0) {
    const wanted = has("refresh-people") ? roster.map((w) => w.name) : missing;
    console.log(`resolving ${wanted.length} wrestlers on Wikidata…`);
    const resolved = await enrichWrestlers(wanted, {
      thumbWidth: PHOTO_WIDTH * 2,
      log: (line) => console.log(line),
    });
    people = { ...people, ...Object.fromEntries(resolved) };
    writeFileSync(
      peoplePath,
      JSON.stringify(Object.fromEntries([...Object.entries(people)].sort()), null, 2) + "\n",
    );
  }

  let photoCount = 0;
  const cards: Player[] = [];
  for (const entry of roster) {
    const card: Player = {
      id: entry.id,
      name: entry.name,
      role: entry.role,
      teamId: entry.teamId,
      nationality: entry.nationality,
      rarity: entry.rarity,
      rating: 0,
      stats: entry.stats,
    };
    const photo = people[entry.name]?.photo ?? null;
    if (photo !== null) {
      const file = `${entry.id}.webp`;
      if (has("photos")) await fetchAndCropPhoto(photo.thumbUrl, photoDir, file);
      if (existsSync(join(photoDir, file))) {
        photoCount += 1;
        card.photo = {
          src: `/cards/${WWE_EDITION_ID}/${file}`,
          author: photo.author,
          license: photo.license,
          ...(photo.licenseUrl === "" ? {} : { licenseUrl: photo.licenseUrl }),
          source: photo.source,
        };
      }
    }
    cards.push(card);
  }

  // A photo nothing refers to any more must not linger in the public dir.
  if (existsSync(photoDir)) {
    const kept = new Set(cards.map((c) => `${c.id}.webp`));
    for (const file of readdirSync(photoDir)) {
      if (!kept.has(file)) rmSync(join(photoDir, file));
    }
  } else {
    mkdirSync(photoDir, { recursive: true });
  }

  const previous = existsSync(editionPath(WWE_EDITION_ID))
    ? (JSON.parse(readFileSync(editionPath(WWE_EDITION_ID), "utf8")) as Edition)
    : undefined;
  const players = regenerateRatings(cards, WWE_STATS);
  const same =
    previous !== undefined &&
    JSON.stringify({ p: previous.players }) === JSON.stringify({ p: players });

  const edition: Edition = {
    id: WWE_EDITION_ID,
    name: "WWE — 2026 Q4",
    version: previous === undefined ? 1 : same ? previous.version : previous.version + 1,
    generatedAt:
      same && previous !== undefined
        ? previous.generatedAt
        : new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    sport: "wrestling",
    series: "WWE",
    // No Squad Draft: it drafts an XI, names bowlers and hands someone the
    // gloves. A wrestling deck has none of that, and pretending otherwise
    // would be the lie this edition exists to avoid (#143).
    supportedModes: ["classic-trumps", "power-trumps"],
    stats: WWE_STATS,
    statGroups: WWE_STAT_GROUPS,
    roles: WWE_ROLES,
    decks: WWE_DECKS,
    powers: WWE_POWERS,
    teams: WWE_TEAMS,
    players,
    sources: WWE_SOURCES,
  };

  const result = editionSchema.safeParse(edition);
  if (!result.success) {
    console.error("edition failed validation:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  writeFileSync(editionPath(WWE_EDITION_ID), JSON.stringify(result.data, null, 2) + "\n");
  console.log(
    `${WWE_EDITION_ID}: ${players.length} cards, ${photoCount} photos, v${result.data.version}`,
  );
  if (!has("photos") && photoCount < players.length) {
    console.log(`(${players.length - photoCount} cards have no photo; rerun with --photos)`);
  }
}

await main();
