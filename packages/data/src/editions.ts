/**
 * Edition loading: versioned JSON files in `packages/data/editions/`,
 * validated against the shared Zod schema on every load.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { editionSchema, type Edition } from "@deckxi/shared";

/** Resolves from both src (tsx) and dist (compiled) to `packages/data/editions`. */
export function editionsDir(): string {
  return fileURLToPath(new URL("../editions", import.meta.url));
}

/** The edition new games pin by default. */
export const CURRENT_EDITION_ID = "edition-2026-q3";

export function listEditionIds(): string[] {
  return readdirSync(editionsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function editionPath(id: string): string {
  if (!/^edition-[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`invalid edition id: ${id}`);
  return join(editionsDir(), `${id}.json`);
}

/** Load and validate one edition; throws with Zod issues on invalid data. */
export function loadEdition(id: string = CURRENT_EDITION_ID): Edition {
  const raw: unknown = JSON.parse(readFileSync(editionPath(id), "utf8"));
  const result = editionSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`edition ${id} failed validation:\n${issues}`);
  }
  return result.data;
}
