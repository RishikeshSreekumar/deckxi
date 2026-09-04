/**
 * The worker's header policy must not drift from `public/_headers`: one of
 * them applies depending on how Pages routes a request, and a difference
 * between them is a security header that exists on some responses only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEdgeHeaders, cacheControlFor, SECURITY_HEADERS } from "./edgeHeaders.js";

const headersFile = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");

describe("edge headers", () => {
  it("declares everything _headers declares", () => {
    for (const key of Object.keys(SECURITY_HEADERS)) {
      expect(headersFile.toLowerCase(), key).toContain(key);
    }
  });

  it("keeps hashed assets immutable and the service worker fresh", () => {
    expect(cacheControlFor("/assets/index-abc123.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("/sw.js")).toBe("no-cache");
    expect(cacheControlFor("/manifest.webmanifest")).toBe("no-cache");
    expect(cacheControlFor("/")).toBeNull();
  });

  it("applies the policy onto a real Headers object", () => {
    const headers = new Headers({ "content-type": "text/html" });
    applyEdgeHeaders(headers, "/assets/app.js");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("cache-control")).toContain("immutable");
    expect(headers.get("content-type")).toBe("text/html");
  });
});
