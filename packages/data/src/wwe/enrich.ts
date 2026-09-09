/**
 * Photographs for the WWE edition. The cricket path keys people by their
 * ESPNcricinfo id; wrestlers have no such register, so we match ring names
 * against Wikidata labels and aliases, constrained to humans whose occupation
 * is professional wrestler — which is what stops "Edge", "Kane" and "Lita"
 * resolving to a guitarist, a philosopher and a moth.
 *
 * From there it is the same machinery as the cricket importer: Wikidata's
 * chosen portrait (P18), or a Commons file tagged as depicting the person,
 * checked against Commons' own licence metadata so only free-to-reuse files
 * with a printable credit reach a card.
 */
import { commonsPhotoInfo, searchCommonsPortrait, type PhotoInfo } from "../import/enrich.js";

const USER_AGENT = "deckxi-importer/0.1 (https://github.com/RishikeshSreekumar/deckxi)";
/** Wikidata's "professional wrestler" occupation. */
const WRESTLER_OCCUPATION = "Q13474373";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

export interface WrestlerPerson {
  /** The name we searched for — the card's ring name. */
  name: string;
  wikidata: string;
  photo: PhotoInfo | null;
  /** ISO date this record was resolved; refresh with `--refresh-people`. */
  resolvedAt: string;
}

interface Binding {
  name: { value: string };
  item: { value: string };
  image?: { value: string };
}

/** Ring name → Wikidata item + portrait, in one query. */
export async function resolveWrestlers(
  names: readonly string[],
): Promise<Map<string, { qid: string; imageFile?: string }>> {
  const out = new Map<string, { qid: string; imageFile?: string }>();
  if (names.length === 0) return out;
  const values = names.map((n) => `${JSON.stringify(n)}@en`).join(" ");
  const query = `SELECT ?name ?item ?image WHERE {
  VALUES ?name { ${values} }
  ?item rdfs:label|skos:altLabel ?name .
  ?item wdt:P106 wd:${WRESTLER_OCCUPATION} .
  OPTIONAL { ?item wdt:P18 ?image }
}`;
  const res = await fetch(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
    { headers: { "user-agent": USER_AGENT, accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from Wikidata`);
  const data = (await res.json()) as { results: { bindings: Binding[] } };
  for (const b of data.results.bindings) {
    const name = b.name.value;
    const qid = b.item.value.replace(/^.*\//, "");
    // Several rows per name when an item has more than one image; the first
    // wins and later rows only fill blanks.
    const hit = out.get(name) ?? { qid };
    if (hit.imageFile === undefined && b.image !== undefined) {
      hit.imageFile = `File:${decodeURIComponent(b.image.value.replace(/^.*Special:FilePath\//, ""))}`;
    }
    out.set(name, hit);
  }
  return out;
}

interface SearchHit {
  id: string;
}

interface EntityClaims {
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
}

/**
 * A ring name Wikidata files under the person's legal name ("Chad Gable" is
 * "Chad Betts") matches no label, so fall back to the search index and keep
 * the first hit whose occupation is professional wrestler — the check that
 * keeps a namesake out of the deck.
 */
export async function searchWrestler(
  name: string,
): Promise<{ qid: string; imageFile?: string } | null> {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "en",
    limit: "5",
    format: "json",
    origin: "*",
  });
  const found = await getJson<{ search?: SearchHit[] }>(`${WIKIDATA_API}?${params}`);
  const ids = (found.search ?? []).map((hit) => hit.id);
  if (ids.length === 0) return null;
  const entities = await getJson<{ entities?: Record<string, EntityClaims> }>(
    `${WIKIDATA_API}?${new URLSearchParams({
      action: "wbgetentities",
      ids: ids.join("|"),
      props: "claims",
      format: "json",
      origin: "*",
    })}`,
  );
  for (const qid of ids) {
    const claims = entities.entities?.[qid]?.claims ?? {};
    const wrestler = (claims["P106"] ?? []).some(
      (c) =>
        (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id === WRESTLER_OCCUPATION,
    );
    if (!wrestler) continue;
    const image = (claims["P18"] ?? [])[0]?.mainsnak?.datavalue?.value;
    return {
      qid,
      ...(typeof image === "string" ? { imageFile: `File:${image}` } : {}),
    };
  }
  return null;
}

/** Resolve a roster end to end. Names Wikidata does not know are omitted. */
export async function enrichWrestlers(
  names: readonly string[],
  options: { thumbWidth: number; log?: (line: string) => void },
): Promise<Map<string, WrestlerPerson>> {
  const log = options.log ?? (() => undefined);
  const hits = await resolveWrestlers(names);
  for (const name of names) {
    if (hits.has(name)) continue;
    const hit = await searchWrestler(name);
    log(`  ${name}: no label match, search → ${hit?.qid ?? "nothing"}`);
    if (hit !== null) hits.set(name, hit);
  }
  const candidates = new Map<string, string>(); // name → File:
  for (const [name, hit] of hits) {
    let file = hit.imageFile;
    if (file === undefined) {
      file = (await searchCommonsPortrait(hit.qid)) ?? undefined;
      log(`  ${name}: no Wikidata image, Commons search → ${file ?? "nothing"}`);
    }
    if (file !== undefined) candidates.set(name, file);
  }

  const photos = await commonsPhotoInfo([...new Set(candidates.values())], options.thumbWidth);
  const resolvedAt = new Date().toISOString().slice(0, 10);
  const out = new Map<string, WrestlerPerson>();
  for (const [name, hit] of hits) {
    const file = candidates.get(name);
    const photo = file === undefined ? null : (photos.get(file) ?? null);
    if (file !== undefined && photo === null) log(`  ${name}: ${file} rejected (licence)`);
    out.set(name, { name, wikidata: hit.qid, photo, resolvedAt });
  }
  for (const name of names) if (!out.has(name)) log(`  ${name}: no Wikidata match`);
  return out;
}
