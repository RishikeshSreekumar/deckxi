import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { PROTOCOL_VERSION } from "@deckxi/shared";
import { buildApp, type App } from "./app.js";

const ORIGINS = ["https://deckxi.rishikeshs.dev", "https://*.deckxi-web.pages.dev"];

let app: App | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  for (const s of sockets) s.disconnect();
  sockets.length = 0;
  await app?.close();
  app = undefined;
});

async function start(): Promise<string> {
  app = buildApp({ corsOrigins: ORIGINS });
  return `http://127.0.0.1:${await app.listen(0)}`;
}

describe("origin hardening", () => {
  it("returns CORS headers only for allowed origins", async () => {
    const url = await start();
    const allowed = await fetch(`${url}/healthz`, { headers: { origin: ORIGINS[0]! } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ORIGINS[0]);

    const preview = await fetch(`${url}/healthz`, {
      headers: { origin: "https://pr-7.deckxi-web.pages.dev" },
    });
    expect(preview.headers.get("access-control-allow-origin")).toBe(
      "https://pr-7.deckxi-web.pages.dev",
    );

    // Denied: the response still succeeds, the browser is the one that blocks.
    const denied = await fetch(`${url}/healthz`, { headers: { origin: "https://evil.example" } });
    expect(denied.status).toBe(200);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects websocket handshakes from a disallowed origin", async () => {
    const url = await start();
    const socket = connect(url, {
      transports: ["websocket"],
      extraHeaders: { origin: "https://evil.example" },
      auth: { protocolVersion: PROTOCOL_VERSION },
    });
    sockets.push(socket);
    const error = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(error.message).toBe("origin not allowed");
  });

  it("accepts websocket handshakes from an allowed origin", async () => {
    const url = await start();
    const socket = connect(url, {
      transports: ["websocket"],
      extraHeaders: { origin: ORIGINS[0]! },
      auth: { protocolVersion: PROTOCOL_VERSION },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    expect(socket.connected).toBe(true);
  });
});
