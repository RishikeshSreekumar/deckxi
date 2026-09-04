import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { PROTOCOL_VERSION } from "@deckxi/shared";
import { buildApp, type App } from "./app.js";
import { serverInfo } from "./index.js";
import { parseEnv } from "./env.js";

let app: App | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  for (const s of sockets) s.disconnect();
  sockets.length = 0;
  await app?.close();
  app = undefined;
});

async function startApp(): Promise<{ app: App; url: string }> {
  app = buildApp();
  const port = await app.listen(0);
  return { app, url: `http://127.0.0.1:${port}` };
}

function client(url: string, auth: Record<string, unknown> = {}): Socket {
  const socket = connect(url, {
    transports: ["websocket"],
    auth: { protocolVersion: PROTOCOL_VERSION, ...auth },
  });
  sockets.push(socket);
  return socket;
}

describe("@deckxi/server", () => {
  it("reports server info", () => {
    expect(serverInfo()).toBe("DeckXI server (protocol v2)");
  });

  it("parses env with defaults and splits CORS origins", () => {
    const env = parseEnv({ CORS_ORIGINS: "http://a.example, http://b.example" });
    expect(env.port).toBe(3001);
    expect(env.corsOrigins).toEqual(["http://a.example", "http://b.example"]);
  });

  // Both paths serve health: Cloud Run reserves the exact path `/healthz` and
  // never forwards it, so `/health` is the one the deploy smoke test uses.
  it.each(["/health", "/healthz"])("serves %s", async (path) => {
    const { url } = await startApp();
    const res = await fetch(`${url}${path}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; protocolVersion: number };
    expect(body.ok).toBe(true);
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("accepts sockets with the right protocol version", async () => {
    const { url } = await startApp();
    const socket = client(url);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    expect(socket.connected).toBe(true);
  });

  it("rejects sockets with a protocol mismatch", async () => {
    const { url } = await startApp();
    const socket = client(url, { protocolVersion: 999 });
    const error = await new Promise<Error>((resolve) => {
      socket.on("connect_error", resolve);
    });
    expect(error.message).toContain("protocol version mismatch");
  });
});
