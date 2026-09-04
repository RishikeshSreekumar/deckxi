/**
 * Rich invite links (#82). The rewrite runs in a Cloudflare worker in front of
 * every request, so what matters is that it changes exactly the four tags it
 * means to and leaves anything that is not an invite completely alone.
 */
import { describe, expect, it } from "vitest";
import { enrichInviteHtml, inviteCodeOf } from "./inviteOg.js";

const PAGE = [
  "<!doctype html><html><head>",
  "<title>DeckXI — cricket trump cards, live with friends</title>",
  '<meta name="description" content="Cricket trump cards, live with friends." />',
  '<meta property="og:title" content="DeckXI — cricket trump cards, live with friends" />',
  '<meta property="og:description" content="Cricket trump cards, live with friends." />',
  '<meta property="og:image" content="/og-default.png" />',
  "</head><body><div id=root></div></body></html>",
].join("\n");

describe("inviteCodeOf", () => {
  it("recognises a join link and upper-cases the code", () => {
    expect(inviteCodeOf("/join/abc123")).toBe("ABC123");
    expect(inviteCodeOf("/join/ABC123/")).toBe("ABC123");
  });

  it("ignores everything else", () => {
    for (const path of [
      "/",
      "/profile",
      "/join",
      "/join/short",
      "/join/toolongcode",
      "/replay/x",
    ]) {
      expect(inviteCodeOf(path), path).toBeNull();
    }
  });
});

describe("enrichInviteHtml", () => {
  const out = enrichInviteHtml(PAGE, "ABC123");

  it("names the table in the title and both share-card tags", () => {
    expect(out).toContain("<title>Join table ABC123 on DeckXI</title>");
    expect(out).toContain('<meta property="og:title" content="Join table ABC123 on DeckXI" />');
    expect(out).toContain("You&#39;ve been invited to a game of cricket trump cards. Code ABC123.");
  });

  it("leaves the image and the document structure alone", () => {
    expect(out).toContain('<meta property="og:image" content="/og-default.png" />');
    expect(out).toContain("<div id=root></div>");
  });

  it("escapes anything that could break out of the title or an attribute", () => {
    // `inviteCodeOf` would never hand this over, but this function is the only
    // thing between a URL and the served HTML and must be safe by itself.
    const nasty = enrichInviteHtml(PAGE, 'A"><script>alert(1)</script>');
    expect(nasty).not.toContain("<script>alert(1)");
    expect(nasty).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("returns the page unchanged when the tags are not there", () => {
    expect(enrichInviteHtml("<html></html>", "ABC123")).toBe("<html></html>");
  });
});
