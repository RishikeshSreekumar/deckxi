import { afterEach, describe, expect, it } from "vitest";
import { clientErrorLimiter } from "./errors.js";
import { startTestServer, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(): Promise<TestServer> {
  server = await startTestServer();
  return server;
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(`${url}/api/telemetry/error`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const report = {
  message: "Cannot read properties of undefined",
  stack: "at GameTable (index-abc.js:1:200)",
  url: "/",
  release: "abc123",
  kind: "error",
};

describe("client error intake", () => {
  it("accepts a well-formed report", async () => {
    const { url } = await start();
    const res = await post(url, report);
    expect(res.status).toBe(204);
  });

  it("rejects a report that isn't one", async () => {
    const { url } = await start();
    expect((await post(url, { kind: "error" })).status).toBe(400);
    expect((await post(url, { message: "x", kind: "made-up" })).status).toBe(400);
    // A stack big enough to be an exfiltration attempt, not a stack.
    expect((await post(url, { message: "x", kind: "error", stack: "y".repeat(9999) })).status).toBe(
      400,
    );
  });

  it("rate-limits a client stuck in a reporting loop", async () => {
    const { url } = await start();
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) {
      // Distinct messages: this is the endpoint's limit, not de-duplication.
      codes.push((await post(url, { ...report, message: `boom ${i}` })).status);
    }
    expect(codes.filter((c) => c === 204)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(4);
  });
});

describe("per-IP limiter", () => {
  it("budgets each address separately", () => {
    const allow = clientErrorLimiter();
    for (let i = 0; i < 10; i++) expect(allow("1.1.1.1")).toBe(true);
    expect(allow("1.1.1.1")).toBe(false);
    expect(allow("2.2.2.2")).toBe(true);
  });
});
