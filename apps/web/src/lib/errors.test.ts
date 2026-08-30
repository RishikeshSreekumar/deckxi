import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError, resetErrorReporting } from "./errors.js";

const posts: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  posts.length = 0;
  resetErrorReporting();
  vi.stubGlobal("location", { pathname: "/join/ABC123" });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client error reporting", () => {
  it("posts a report with the release and the page path", () => {
    reportError({ message: "boom", stack: "at x", kind: "error" });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/api\/telemetry\/error$/);
    expect(posts[0]?.body).toMatchObject({
      message: "boom",
      stack: "at x",
      kind: "error",
      url: "/join/ABC123",
    });
    expect(posts[0]?.body["release"]).toBeTypeOf("string");
  });

  it("sends the same error once, however often it fires", () => {
    for (let i = 0; i < 5; i++) reportError({ message: "boom", stack: "at x", kind: "error" });
    expect(posts).toHaveLength(1);
    reportError({ message: "different", kind: "error" });
    expect(posts).toHaveLength(2);
  });

  it("caps a session, so a render loop can't flood the server", () => {
    for (let i = 0; i < 40; i++) reportError({ message: `boom ${i}`, kind: "boundary" });
    expect(posts).toHaveLength(10);
  });

  it("truncates a runaway message rather than posting it whole", () => {
    reportError({ message: "x".repeat(2000), kind: "unhandledrejection" });
    expect((posts[0]?.body["message"] as string).length).toBe(500);
  });

  it("survives the server being the thing that's down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    expect(() => {
      reportError({ message: "boom", kind: "error" });
    }).not.toThrow();
    await Promise.resolve();
  });
});
