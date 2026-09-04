/**
 * Cloudflare Pages worker (advanced mode). Everything is a static asset
 * except `/join/:code`, which gets its share-card meta rewritten so an invite
 * pasted into a chat previews as the table it invites you to (#82).
 *
 * Two rules keep this safe to have in front of the whole site:
 *
 *   1. Anything that is not an invite is passed straight to `ASSETS`,
 *      untouched.
 *   2. The SPA fallback is explicit here rather than inherited from
 *      `_redirects`. A worker that assumed the asset server would still apply
 *      that file would break every deep link the day the assumption stopped
 *      holding, and deep links are how most players arrive.
 *
 *   3. `public/_headers` may not be applied to requests that pass through a
 *      worker, so the same policy is set here from `lib/edgeHeaders.ts`.
 *
 * Kill switch: delete `dist/_worker.js` (build without `scripts/build-worker.mjs`)
 * and Pages serves the site exactly as it did before this existed.
 */
import { enrichInviteHtml, inviteCodeOf } from "../lib/inviteOg.js";
import { applyEdgeHeaders } from "../lib/edgeHeaders.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** The SPA shell, for a path only the client router knows about. */
async function shell(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/index.html";
  return await env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const code = inviteCodeOf(url.pathname);

    if (code === null) {
      const asset = await env.ASSETS.fetch(request);
      // A missing asset on a GET is a client route: serve the shell so
      // /profile, /leaderboard and friends keep working on a hard refresh.
      const response =
        asset.status === 404 && request.method === "GET" ? await shell(request, env) : asset;
      const headers = new Headers(response.headers);
      applyEdgeHeaders(headers, url.pathname);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const page = await shell(request, env);
    if (!page.ok) return page;
    const html = enrichInviteHtml(await page.text(), code);
    const headers = new Headers(page.headers);
    applyEdgeHeaders(headers, url.pathname);
    headers.set("content-type", "text/html; charset=utf-8");
    // The code is in the body, so this page is not the one to cache.
    headers.set("cache-control", "no-cache");
    return new Response(html, { status: 200, headers });
  },
};
