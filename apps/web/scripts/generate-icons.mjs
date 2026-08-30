/**
 * App identity assets (#108). One SVG source, every size generated from it,
 * so the icon set can never drift the way a folder of hand-exported PNGs
 * does.
 *
 *   pnpm --filter @deckxi/web icons
 *
 * The mark is the cricket-seam crest from the card back, reduced until it
 * survives 48px on a home screen: the ring, two seam arcs and the XI
 * monogram. The card back's radiating field lines and corner pips are gone —
 * they turn to mush below about 96px.
 *
 * Colours are the dark theme's own tokens rather than "whatever looked
 * right": an app icon does not follow a theme, so it commits to the product
 * default.
 *
 * Written into public/, which Vite copies into the build verbatim.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
// The tokens subpath is pure ESM with no JSON imports, so it loads in a
// plain node script; the package root pulls in the edition data and does not.
import { palettes } from "@deckxi/ui/tokens";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(webRoot, "public");
const dark = palettes.dark;

/**
 * @param inset Fraction of the canvas to keep clear around the mark. Android
 *   maskable icons can be cropped to a circle inscribed in the central 80%,
 *   so a maskable variant needs its content well inside that.
 * @param bleed When true the background fills the whole canvas edge to edge
 *   (maskable and apple-touch want no transparency and no self-rounded
 *   corners — the platform supplies the shape).
 */
function iconSvg({ inset = 0.06, bleed = false, radius = 96 } = {}) {
  const s = 512;
  const c = s / 2;
  const r = c * (1 - inset) * 0.78;
  const seam = r * 0.72;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs>
    <radialGradient id="field" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="${dark.surfacePanel}"/>
      <stop offset="100%" stop-color="${dark.surfaceBase}"/>
    </radialGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${bleed ? 0 : radius}" fill="url(#field)"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${dark.interactiveAccentHover}" stroke-width="${s * 0.035}"/>
  <path d="M${c - seam} ${c - seam * 0.62} Q${c} ${c - seam * 0.18} ${c + seam} ${c - seam * 0.62}"
        fill="none" stroke="${dark.interactiveAccentHover}" stroke-width="${s * 0.026}"
        stroke-linecap="round" stroke-dasharray="${s * 0.05} ${s * 0.042}"/>
  <path d="M${c - seam} ${c + seam * 0.62} Q${c} ${c + seam * 0.18} ${c + seam} ${c + seam * 0.62}"
        fill="none" stroke="${dark.interactiveAccentHover}" stroke-width="${s * 0.026}"
        stroke-linecap="round" stroke-dasharray="${s * 0.05} ${s * 0.042}"/>
  <text x="${c}" y="${c + s * 0.075}" text-anchor="middle" fill="${dark.textPrimary}"
        font-family="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif"
        font-size="${s * 0.235}" font-weight="800" letter-spacing="${s * 0.012}">XI</text>
</svg>`;
}

function ogSvg() {
  const w = 1200;
  const h = 630;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <radialGradient id="glow" cx="26%" cy="50%" r="70%">
      <stop offset="0%" stop-color="${dark.surfacePanel}"/>
      <stop offset="100%" stop-color="${dark.surfaceBase}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <g transform="translate(96 155) scale(0.62)">${iconSvg({ radius: 110 })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "")}</g>
  <text x="470" y="286" fill="${dark.textPrimary}"
        font-family="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif"
        font-size="96" font-weight="800" letter-spacing="-2">Deck<tspan fill="${dark.textAccent}">XI</tspan></text>
  <text x="474" y="352" fill="${dark.textSecondary}"
        font-family="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif"
        font-size="38">Cricket trump cards, live with friends</text>
</svg>`;
}

/**
 * A single-image .ico wrapping a PNG. Every browser since Vista reads
 * PNG-in-ICO, and it exists purely so the automatic /favicon.ico request does
 * not fall through the SPA rewrite and get served index.html.
 */
function ico(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size < 256 ? size : 0, 0); // width (0 means 256)
  entry.writeUInt8(size < 256 ? size : 0, 1); // height
  entry.writeUInt8(0, 2); // palette size
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

const TARGETS = [
  { file: "icon-192.png", size: 192, svg: iconSvg() },
  { file: "icon-512.png", size: 512, svg: iconSvg() },
  // Maskable: content pulled well inside Android's safe zone, background to
  // the edge, no corner radius of our own.
  { file: "icon-maskable-512.png", size: 512, svg: iconSvg({ inset: 0.22, bleed: true }) },
  { file: "apple-touch-icon.png", size: 180, svg: iconSvg({ inset: 0.1, bleed: true }) },
  { file: "favicon-32.png", size: 32, svg: iconSvg({ radius: 64 }) },
];

mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "icon.svg"), `${iconSvg()}\n`);

const browser = await chromium.launch();
try {
  for (const target of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${target.size}px;height:${target.size}px}</style>${target.svg}`,
    );
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ omitBackground: true });
    writeFileSync(join(publicDir, target.file), png);
    if (target.file === "favicon-32.png") {
      writeFileSync(join(publicDir, "favicon.ico"), ico(png, target.size));
    }
    await page.close();
    console.log(`✓ ${target.file} (${target.size}px)`);
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<style>html,body{margin:0;padding:0}svg{display:block}</style>${ogSvg()}`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(join(publicDir, "og-default.png"), await page.screenshot());
  await page.close();
  console.log("✓ og-default.png (1200x630)");
} finally {
  await browser.close();
}

console.log(`\nWrote identity assets to ${publicDir}`);
