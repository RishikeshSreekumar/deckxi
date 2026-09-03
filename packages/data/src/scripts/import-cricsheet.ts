/**
 * Build (or refresh) the shipped edition from Cricsheet's men's T20
 * International ball-by-ball data.
 *
 *   pnpm --filter @deckxi/data import-cricsheet [flags]
 *
 *   --edition <id>       edition to write (default: the current edition)
 *   --source <dir>       directory of Cricsheet match JSON (default: download
 *                        t20s_male_json.zip into .cache/ and unzip it)
 *   --people-csv <path>  Cricsheet register (default: downloaded alongside)
 *   --refresh-people     re-resolve names/photos on Wikidata + Commons even
 *                        for players already in sources/people.json
 *   --photos             download and crop card photos (needs the network)
 *   --photo-dir <dir>    where photos go (default: apps/web/public/cards/<edition>)
 *
 * Deterministic for a given source snapshot: stats are derived, never typed
 * in; names and photos come from the committed cache unless asked to
 * refresh. See docs/data-sources.md for the licences involved.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { editionSchema, type Edition, type Player, type PlayerRole } from "@deckxi/shared";
import { CURRENT_EDITION_ID, editionPath } from "../editions.js";
import { analyzeBalance, formatBalanceReport } from "../balance.js";
import { regenerateRatings } from "../rating.js";
import { aggregateDirectory } from "../import/cricsheet.js";
import { T20I_SELECTION, T20I_STATS } from "../import/config.js";
import { enrichPeople, type PersonInfo } from "../import/enrich.js";
import { fetchAndCropPhoto, PHOTO_WIDTH } from "../import/photos.js";
import { assignRarity, deriveStats, fitBounds, selectSquads, slugify } from "../import/select.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const cacheDir = join(packageRoot, ".cache", "cricsheet");
const sourcesDir = join(packageRoot, "sources");
const ZIP_URL = "https://cricsheet.org/downloads/t20s_male_json.zip";
const PEOPLE_URL = "https://cricsheet.org/register/people.csv";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function download(url: string, to: string): Promise<void> {
  if (existsSync(to)) return;
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { "user-agent": "deckxi-importer/0.1" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  mkdirSync(join(to, ".."), { recursive: true });
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

async function sourceDir(): Promise<string> {
  const given = flag("source");
  if (given !== undefined) return resolve(given);
  const zip = join(cacheDir, "t20s_male_json.zip");
  const dir = join(cacheDir, "t20s_male_json");
  await download(ZIP_URL, zip);
  if (!existsSync(join(dir, "README.txt"))) {
    mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  }
  return dir;
}

async function peopleCsv(): Promise<string> {
  const given = flag("people-csv");
  if (given !== undefined) return resolve(given);
  const path = join(cacheDir, "people.csv");
  await download(PEOPLE_URL, path);
  return path;
}

/** Cricsheet id → ESPNcricinfo id, from the register. */
function cricinfoKeys(csvPath: string): Map<string, string> {
  const lines = readFileSync(csvPath, "utf8").split("\n");
  const header = (lines[0] ?? "").split(",");
  const col = header.indexOf("key_cricinfo");
  const map = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    if (cells[0] !== undefined && cells[col] !== undefined && cells[col] !== "") {
      map.set(cells[0], cells[col]);
    }
  }
  return map;
}

interface Overrides {
  roles: Record<string, PlayerRole>;
  names: Record<string, string>;
  photos: Record<string, string | null>;
  /** Shirt numbers, hand-curated: no open dataset carries them. */
  jerseys: Record<string, number>;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

async function main(): Promise<void> {
  const editionId = flag("edition") ?? CURRENT_EDITION_ID;
  const photoDir =
    flag("photo-dir") ?? join(packageRoot, "..", "..", "apps", "web", "public", "cards", editionId);

  const dir = await sourceDir();
  const {
    players: aggregates,
    matches,
    lastMatch,
  } = aggregateDirectory(dir, {
    gender: "male",
    matchType: "T20",
    teamType: "international",
  });
  console.log(`aggregated ${aggregates.size} players over ${matches} T20Is (to ${lastMatch})`);

  const overrides = readJson<Overrides>(join(sourcesDir, "overrides.json"), {
    roles: {},
    names: {},
    photos: {},
    jerseys: {},
  });
  // Names + photos: cached, resolved over the network only for newcomers.
  const peoplePath = join(sourcesDir, "people.json");
  const people = readJson<Record<string, PersonInfo>>(peoplePath, {});
  const keys = cricinfoKeys(await peopleCsv());
  let refreshed = false;

  /**
   * Squad selection prefers players with a usable photograph, which we only
   * learn by resolving them — so select, resolve the newcomers, push anyone
   * without a photo to the back of the queue, and select again until the
   * squad stops changing. A nation short of photographed players keeps its
   * best faceless ones; a squad is never left short.
   */
  const faceless = new Set<string>(
    Object.entries(people)
      .filter(([, p]) => p.photo === null)
      .map(([id]) => id),
  );
  let selected: ReturnType<typeof selectSquads> = [];
  for (let pass = 1; pass <= 30; pass++) {
    selected = selectSquads(aggregates.values(), {
      ...T20I_SELECTION,
      roleOverrides: overrides.roles,
      deprioritized: faceless,
    });
    const toResolve = selected
      .filter((s) => (has("refresh-people") && !refreshed) || people[s.agg.id] === undefined)
      .map((s) => ({
        cricsheetId: s.agg.id,
        cricinfo: keys.get(s.agg.id) ?? "",
        ...(s.agg.id in overrides.photos ? { photoOverride: overrides.photos[s.agg.id] } : {}),
      }))
      .filter((s) => s.cricinfo !== "");
    refreshed = true;
    if (toResolve.length === 0) break;
    console.log(`pass ${pass}: resolving ${toResolve.length} people on Wikidata / Commons…`);
    const resolved = await enrichPeople(toResolve, {
      thumbWidth: PHOTO_WIDTH * 2,
      log: console.log,
    });
    for (const [id, info] of resolved) people[id] = info;
    // Someone the register knows but Wikidata does not is faceless too.
    let newlyFaceless = 0;
    for (const s of toResolve) {
      if ((people[s.cricsheetId]?.photo ?? null) === null && !faceless.has(s.cricsheetId)) {
        faceless.add(s.cricsheetId);
        newlyFaceless += 1;
      }
    }
    const ordered = Object.fromEntries(
      Object.entries(people).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(peoplePath, JSON.stringify(ordered, null, 2) + "\n");
    if (newlyFaceless === 0) break;
  }
  console.log(`selected ${selected.length} cards across ${T20I_SELECTION.teams.length} nations`);

  const usedIds = new Set<string>();
  const cards: Omit<Player, "rating" | "rarity">[] = [];
  let photoCount = 0;
  for (const s of selected) {
    const person = people[s.agg.id];
    const name = overrides.names[s.agg.id] ?? person?.name ?? s.agg.name;
    let id = slugify(name);
    if (usedIds.has(id)) id = `${id}-${s.team.shortName.toLowerCase()}`;
    usedIds.add(id);

    const card: Omit<Player, "rating" | "rarity"> = {
      id,
      name,
      role: s.role,
      teamId: s.team.id,
      nationality: s.team.name,
      stats: deriveStats(s.agg),
    };
    const jersey = overrides.jerseys[s.agg.id];
    if (jersey !== undefined) card.jerseyNumber = jersey;
    const photo = person?.photo ?? null;
    if (photo !== null) {
      const file = `${id}.webp`;
      if (has("photos")) await fetchAndCropPhoto(photo.thumbUrl, photoDir, file);
      if (existsSync(join(photoDir, file))) {
        photoCount += 1;
        card.photo = {
          src: `/cards/${editionId}/${file}`,
          author: photo.author,
          license: photo.license,
          ...(photo.licenseUrl === "" ? {} : { licenseUrl: photo.licenseUrl }),
          source: photo.source,
        };
      }
    }
    cards.push(card);
  }

  // Photos nothing refers to any more (a player dropped out of the squad, or
  // a photo was withdrawn) must not linger in the public directory.
  if (existsSync(photoDir)) {
    const referenced = new Set(cards.map((c) => c.photo?.src.replace(/^.*\//, "")));
    for (const file of readdirSync(photoDir)) {
      if (!referenced.has(file)) {
        unlinkSync(join(photoDir, file));
        console.log(`  pruned stale photo ${file}`);
      }
    }
  }

  const stats = fitBounds(
    T20I_STATS.map((s) => ({ ...s, min: 0, max: 1 })),
    cards,
  );
  const rated = regenerateRatings(
    cards.map((c) => ({ ...c, rarity: "regular" as const, rating: 0 })),
    stats,
  );
  const players = assignRarity(rated, T20I_SELECTION.tiers);

  const path = editionPath(editionId);
  const previous = existsSync(path)
    ? editionSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
    : undefined;
  const prev = previous?.success === true ? previous.data : undefined;
  const same =
    prev !== undefined &&
    JSON.stringify({ s: prev.stats, t: prev.teams, p: prev.players }) ===
      JSON.stringify({ s: stats, t: T20I_SELECTION.teams, p: players });

  const edition: Edition = {
    id: editionId,
    name: `T20 Internationals — ${editionId.replace(/^edition-(\d{4})-q(\d)$/, "$1 Q$2")}`,
    version: prev === undefined ? 1 : same ? prev.version : prev.version + 1,
    generatedAt: same ? prev.generatedAt : new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    stats,
    teams: T20I_SELECTION.teams,
    players,
    sources: [
      {
        name: "Cricsheet",
        url: "https://cricsheet.org/",
        license: "ODC-By 1.0",
        licenseUrl: "https://opendatacommons.org/licenses/by/1-0/",
        note: `Career figures derived from ${matches} men's T20 Internationals to ${lastMatch}`,
      },
      {
        name: "Wikidata",
        url: "https://www.wikidata.org/",
        license: "CC0 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        note: "Player names, matched by ESPNcricinfo id",
      },
      {
        name: "Wikimedia Commons",
        url: "https://commons.wikimedia.org/",
        license: "Per photo — see each card's credit",
        note: "Player photographs; individual authors and licences are recorded on every card",
      },
    ],
  };

  const parsed = editionSchema.safeParse(edition);
  if (!parsed.success) {
    throw new Error(
      `import produced an invalid edition:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  writeFileSync(path, JSON.stringify(parsed.data, null, 2) + "\n");
  console.log(
    `${editionId}: v${edition.version}${same ? " (unchanged)" : ""}, ${players.length} cards, ${photoCount} with photos`,
  );
  console.log(formatBalanceReport(analyzeBalance(parsed.data)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
