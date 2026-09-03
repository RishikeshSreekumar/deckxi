/**
 * Card photographs: download the Commons rendition and cut it to the card's
 * photo window. One square-ish WebP per player, small enough that a whole
 * deck is a few megabytes, written where the web app serves static files.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export const PHOTO_WIDTH = 480;
export const PHOTO_HEIGHT = 560;

export async function fetchAndCropPhoto(
  thumbUrl: string,
  outDir: string,
  fileName: string,
  options: { force?: boolean } = {},
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, fileName);
  if (existsSync(outPath) && options.force !== true) return outPath;
  const headers = {
    "user-agent": "deckxi-importer/0.1 (https://github.com/RishikeshSreekumar/deckxi)",
  };
  // Commons throttles bursts; one polite retry covers a whole-deck refresh.
  let res = await fetch(thumbUrl, { headers });
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(thumbUrl, { headers });
  }
  if (!res.ok) throw new Error(`${res.status} fetching ${thumbUrl}`);
  const input = Buffer.from(await res.arrayBuffer());
  const upright = sharp(input).rotate();
  const meta = await upright.metadata();
  // A taller-than-card source is cropped top and bottom: the head is near
  // the top of a portrait, and "attention" happily keeps the shirt instead.
  // A wider source is cropped at the sides, where attention does fine.
  const tall = (meta.width ?? 1) / (meta.height ?? 1) < PHOTO_WIDTH / PHOTO_HEIGHT;
  const output = await upright
    .resize(PHOTO_WIDTH, PHOTO_HEIGHT, {
      fit: "cover",
      position: tall ? "top" : sharp.strategy.attention,
    })
    .webp({ quality: 74 })
    .toBuffer();
  writeFileSync(outPath, output);
  return outPath;
}
