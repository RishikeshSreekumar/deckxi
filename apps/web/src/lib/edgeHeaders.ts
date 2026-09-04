/**
 * The headers `public/_headers` declares, as code (#82).
 *
 * A Pages project in advanced mode (a `dist/_worker.js`) serves every request
 * through the worker, and it is not safe to assume the asset server still
 * applies `_headers` on the way past. Losing them silently would mean losing
 * `nosniff`, the framing ban and the cache rules that keep an installed PWA
 * from getting stuck on an old build — three regressions nobody would notice
 * until they mattered.
 *
 * So the worker sets them itself, and this module is the single description
 * both it and `_headers` are checked against.
 */

/** Applies to every response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  // `microphone=(self)` since #89: voice chat needs getUserMedia from our own
  // origin. Geolocation and camera stay banned outright — nothing in this game
  // has any business asking for either.
  "permissions-policy": "geolocation=(), microphone=(self), camera=()",
};

/**
 * Cache policy by path. Hashed build output is immutable; the worker, the
 * registration shim and the manifest must never be, because a stale `sw.js`
 * is how an installed PWA ends up on an old build with no way out but
 * clearing site data.
 */
export function cacheControlFor(pathname: string): string | null {
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (["/sw.js", "/registerSW.js", "/manifest.webmanifest"].includes(pathname)) return "no-cache";
  return null;
}

/** Copy the policy onto a response's headers, in place. */
export function applyEdgeHeaders(headers: Headers, pathname: string): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  const cache = cacheControlFor(pathname);
  if (cache !== null) headers.set("cache-control", cache);
}
