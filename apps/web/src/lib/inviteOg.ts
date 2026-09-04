/**
 * Rich invite links (#82).
 *
 * An invite arrives in a chat app, and what the recipient sees before they tap
 * is whatever the link preview says. A static "DeckXI — cricket trump cards"
 * card is a missed sentence: the useful preview names the table you are being
 * invited to.
 *
 * The SPA cannot do this itself — a crawler never runs the JavaScript that
 * would set the tags — so the built `index.html` is rewritten per request for
 * `/join/:code` by the Pages worker. This module is the rewrite, kept pure so
 * the interesting part is testable without a Cloudflare runtime.
 *
 * The image stays a static asset. A per-room image would have to be composed
 * on the fly for a room that may not exist by the time anyone looks, and the
 * invite's value is the code and the names, which live in the text.
 */

/** Join codes are six characters; anything else is not an invite. */
export const JOIN_CODE_PATTERN = /^\/join\/([A-Za-z0-9]{6})\/?$/;

/** The code in a `/join/CODE` path, upper-cased, or null. */
export function inviteCodeOf(pathname: string): string | null {
  const match = JOIN_CODE_PATTERN.exec(pathname);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Escape for both an attribute value and element text. The code reaching here
 * has already been through `inviteCodeOf`'s six-character pattern, but this
 * function must be safe on its own: it is the only thing standing between a
 * URL and the served HTML, and "the caller validates" is how injection bugs
 * get written.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replaceMeta(html: string, attribute: string, key: string, content: string): string {
  // Matches the tag as our own index.html writes it: one line, double quotes,
  // attribute first. Deliberately narrow — a loose regex over HTML is a bug
  // waiting for the day someone adds a similar tag.
  const pattern = new RegExp(`<meta ${attribute}="${key}" content="[^"]*" ?/?>`);
  return html.replace(pattern, `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`);
}

/**
 * Point the page's title and share card at one table. Returns the html
 * unchanged when a tag is missing, which is the right failure: a preview that
 * is merely generic beats a page that fails to render.
 */
export function enrichInviteHtml(html: string, code: string): string {
  const title = `Join table ${code} on DeckXI`;
  const description = `You've been invited to a game of cricket trump cards. Code ${code}.`;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  out = replaceMeta(out, "name", "description", description);
  out = replaceMeta(out, "property", "og:title", title);
  out = replaceMeta(out, "property", "og:description", description);
  return out;
}
