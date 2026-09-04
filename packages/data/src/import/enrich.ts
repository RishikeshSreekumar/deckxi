/**
 * Names and photographs for real players, from sources we are allowed to use.
 *
 * Cricsheet prints scorecard names ("V Kohli"). The register gives each person
 * an ESPNcricinfo id, and Wikidata indexes people by that id (property P2697),
 * so one SPARQL query turns a squad of ids into full names (CC0), Wikipedia
 * links and the Wikimedia Commons portrait Wikidata has chosen for them
 * (P18). Players without a P18 fall back to a Commons search for files tagged
 * as depicting them.
 *
 * Every candidate photo is then checked against Commons' own licence
 * metadata: only CC BY / CC BY-SA / CC0 / public-domain / government-open
 * files are accepted, and the author + licence are recorded so the UI can
 * print the credit the licence asks for. Anything else is dropped and the
 * card keeps its silhouette.
 *
 * Results are cached in `sources/people.json` (committed), so a routine
 * stats refresh never touches the network and a rerun is reproducible.
 */

const USER_AGENT = "deckxi-importer/0.1 (https://github.com/RishikeshSreekumar/deckxi)";

export interface PhotoInfo {
  /** Commons file title, e.g. "File:Virat Kohli in PMO New Delhi.jpg". */
  file: string;
  /** Commons file page — the "source" half of an attribution. */
  source: string;
  /** Direct URL of the sized rendition the importer downloads. */
  thumbUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
}

export interface PersonInfo {
  cricinfo: string;
  wikidata: string;
  /** Full display name. */
  name: string;
  wikipedia?: string;
  photo: PhotoInfo | null;
  /** ISO date this record was resolved; refresh with `--refresh-people`. */
  resolvedAt: string;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

interface SparqlBinding {
  cricinfo: { value: string };
  item: { value: string };
  itemLabel?: { value: string };
  article?: { value: string };
  image?: { value: string };
}

export interface WikidataHit {
  cricinfo: string;
  qid: string;
  label: string;
  wikipedia?: string;
  /** Commons file title with the "File:" prefix. */
  imageFile?: string;
}

/** Resolve ESPNcricinfo ids to Wikidata items in one query. */
export async function resolveWikidata(cricinfoIds: readonly string[]): Promise<WikidataHit[]> {
  if (cricinfoIds.length === 0) return [];
  const values = cricinfoIds.map((id) => JSON.stringify(id)).join(" ");
  const query = `SELECT ?cricinfo ?item ?itemLabel ?article ?image WHERE {
  VALUES ?cricinfo { ${values} }
  ?item wdt:P2697 ?cricinfo .
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const data = await getJson<{ results: { bindings: SparqlBinding[] } }>(url);
  const hits = new Map<string, WikidataHit>();
  for (const b of data.results.bindings) {
    const existing = hits.get(b.cricinfo.value);
    const qid = b.item.value.replace(/^.*\//, "");
    // Several rows per id when an item has multiple images; keep the first
    // and only fill blanks from later rows.
    const hit: WikidataHit = existing ?? {
      cricinfo: b.cricinfo.value,
      qid,
      label: b.itemLabel?.value ?? qid,
    };
    if (hit.wikipedia === undefined && b.article !== undefined) hit.wikipedia = b.article.value;
    if (hit.imageFile === undefined && b.image !== undefined) {
      hit.imageFile = `File:${decodeURIComponent(b.image.value.replace(/^.*Special:FilePath\//, ""))}`;
    }
    hits.set(b.cricinfo.value, hit);
  }
  return [...hits.values()];
}

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/**
 * A Commons photo for someone Wikidata has no portrait of: a file tagged as
 * depicting that exact item. (Searching by name or category was tried and
 * dropped — it happily returns a namesake from another century.)
 */
export async function searchCommonsPortrait(qid: string): Promise<string | null> {
  const searches = [`haswbstatement:P180=${qid} filetype:bitmap`];
  for (const srsearch of searches) {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srnamespace: "6",
      srlimit: "5",
      srsearch,
      format: "json",
    });
    const data = await getJson<{ query?: { search?: { title: string }[] } }>(
      `${COMMONS_API}?${params}`,
    );
    const hit = data.query?.search?.find((s) => /\.(jpe?g|png|webp)$/i.test(s.title));
    if (hit !== undefined) return hit.title;
  }
  return null;
}

interface ImageInfoPage {
  title: string;
  missing?: boolean;
  imageinfo?: {
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
}

/** Licences we can reuse with attribution (no NC, no ND, no fair use). */
const FREE_LICENSE = /^(CC BY(-SA)?( \d|$)|CC0|Public domain|PD|GODL|OGL|FAL|GFDL)/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Commons metadata is HTML: keep the words, drop the markup and entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Licence + credit for Commons files, in batches. Files whose licence is not
 * a free reuse licence map to null.
 */
export async function commonsPhotoInfo(
  files: readonly string[],
  width: number,
): Promise<Map<string, PhotoInfo | null>> {
  const out = new Map<string, PhotoInfo | null>();
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const params = new URLSearchParams({
      action: "query",
      titles: batch.join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: String(width),
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Copyrighted|UsageTerms",
      format: "json",
    });
    const data = await getJson<{
      query?: { normalized?: { from: string; to: string }[]; pages: Record<string, ImageInfoPage> };
    }>(`${COMMONS_API}?${params}`);
    const back = new Map((data.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(data.query?.pages ?? {})) {
      const requested = back.get(page.title) ?? page.title;
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      const license = stripHtml(meta["LicenseShortName"]?.value ?? "");
      if (
        page.missing === true ||
        info?.thumburl === undefined ||
        !FREE_LICENSE.test(license) ||
        /non-free|fair use/i.test(meta["UsageTerms"]?.value ?? "")
      ) {
        out.set(requested, null);
        continue;
      }
      const artist = stripHtml(meta["Artist"]?.value ?? "");
      out.set(requested, {
        file: page.title,
        source:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        thumbUrl: info.thumburl,
        author: artist === "" ? "Unknown author" : artist.slice(0, 120),
        license,
        licenseUrl: stripHtml(meta["LicenseUrl"]?.value ?? ""),
      });
    }
  }
  return out;
}

export interface EnrichInput {
  cricsheetId: string;
  cricinfo: string;
  /** Forced Commons file (or null to forbid any photo) from the overrides file. */
  photoOverride?: string | null;
}

/** Resolve a batch of people end to end. Unresolvable ids are omitted. */
export async function enrichPeople(
  inputs: readonly EnrichInput[],
  options: { thumbWidth: number; log?: (line: string) => void },
): Promise<Map<string, PersonInfo>> {
  const log = options.log ?? (() => undefined);
  const hits = await resolveWikidata(inputs.map((i) => i.cricinfo));
  const byCricinfo = new Map(hits.map((h) => [h.cricinfo, h]));

  const candidates = new Map<string, string>(); // cricsheet id → File:
  for (const input of inputs) {
    const hit = byCricinfo.get(input.cricinfo);
    if (hit === undefined) continue;
    if (input.photoOverride === null) continue;
    let file = input.photoOverride ?? hit.imageFile;
    if (file === undefined) {
      file = (await searchCommonsPortrait(hit.qid)) ?? undefined;
      log(`  ${hit.label}: no Wikidata image, Commons search → ${file ?? "nothing"}`);
    }
    if (file !== undefined) candidates.set(input.cricsheetId, file);
  }

  const photos = await commonsPhotoInfo([...new Set(candidates.values())], options.thumbWidth);
  const resolvedAt = new Date().toISOString().slice(0, 10);
  const out = new Map<string, PersonInfo>();
  for (const input of inputs) {
    const hit = byCricinfo.get(input.cricinfo);
    if (hit === undefined) continue;
    const file = candidates.get(input.cricsheetId);
    const photo = file === undefined ? null : (photos.get(file) ?? null);
    if (file !== undefined && photo === null) log(`  ${hit.label}: ${file} rejected (licence)`);
    out.set(input.cricsheetId, {
      cricinfo: input.cricinfo,
      wikidata: hit.qid,
      name: hit.label,
      ...(hit.wikipedia === undefined ? {} : { wikipedia: hit.wikipedia }),
      photo,
      resolvedAt,
    });
  }
  return out;
}
