/**
 * Bundle the Pages worker into `dist/_worker.js` (#82).
 *
 * Pages' advanced mode looks for exactly that file at the root of the deployed
 * directory. It is bundled here rather than hand-written so the invite rewrite
 * can be shared with — and tested alongside — the app's own code.
 *
 * **Opt-in.** A worker sits in front of every request on the site, and the
 * only thing it buys is a nicer link preview for invites. That is not worth
 * carrying while the deployment is young, so it builds only when
 * `WEB_EDGE_WORKER=1`. Without it Pages serves the site the plain way, with
 * `_redirects` and `_headers` doing exactly what they did before.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

if (process.env.WEB_EDGE_WORKER !== "1") {
  console.log("skipping dist/_worker.js (set WEB_EDGE_WORKER=1 to build it)");
  process.exit(0);
}

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
