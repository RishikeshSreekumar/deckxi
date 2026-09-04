/**
 * Bundle the Pages worker into `dist/_worker.js` (#82).
 *
 * Pages' advanced mode looks for exactly that file at the root of the deployed
 * directory. It is bundled here rather than hand-written so the invite rewrite
 * can be shared with — and tested alongside — the app's own code.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

await build({
  entryPoints: [`${webRoot}src/worker/index.ts`],
  outfile: `${webRoot}dist/_worker.js`,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  minify: true,
});

console.log("built dist/_worker.js");
