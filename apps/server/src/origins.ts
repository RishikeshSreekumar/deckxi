/**
 * Origin allowlisting for CORS and websocket upgrades.
 *
 * Deploy preview URLs are per-PR (`https://abc123.deckxi-web.pages.dev`), so
 * the allowlist accepts a single leading `*` wildcard in the host label —
 * everything else must match exactly, scheme and port included.
 */

/** Split a `CORS_ORIGINS` value into trimmed, non-empty patterns. */
export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function matches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  const star = pattern.indexOf("*");
  if (star === -1) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;
  if (origin.length < prefix.length + suffix.length) return false;
  // The wildcard stands in for one host label: no dots, no slashes.
  const filled = origin.slice(prefix.length, origin.length - suffix.length);
  return filled.length > 0 && !filled.includes(".") && !filled.includes("/");
}

/**
 * Build an origin predicate. A missing origin (same-origin fetches, curl,
 * Fly health checks) is allowed — there is no browser to protect there.
 */
export function originMatcher(
  patterns: readonly string[],
): (origin: string | undefined) => boolean {
  return (origin) => origin === undefined || patterns.some((p) => matches(p, origin));
}
