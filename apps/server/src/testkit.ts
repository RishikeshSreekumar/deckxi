/**
 * Test helpers: spin up the app on an ephemeral port and drive it with real
 * socket.io clients. Excluded from the production build.
 */
import { io as connect, type Socket } from "socket.io-client";
import { PROTOCOL_VERSION, type Ack } from "@deckxi/shared";
import type { GameState } from "@deckxi/engine";
import { buildApp, type App, type AppOptions } from "./app.js";
import type { Room } from "./rooms.js";

/** The trumps state inside a room — tests that drive trumps games read it directly. */
export function trumpsState(room: Room | undefined): GameState {
  const state = room?.game?.state;
  if (state === undefined) throw new Error("no game in this room");
  return state as GameState;
}

export interface TestServer {
  app: App;
  url: string;
  /** Connect a new client (protocol handshake included). Pass a cookie
   *  header to connect as a signed-in user. */
  client(headers?: Record<string, string>): TestClient;
  close(): Promise<void>;
}

export class TestClient {
  constructor(public readonly socket: Socket) {}

  /** Emit with ack and unwrap `Ack<T>`; rejects on an error ack. */
  async call<T>(event: string, payload?: unknown): Promise<T> {
    const reply = (await this.socket.timeout(5000).emitWithAck(event, payload)) as Ack<T>;
    if (!reply.ok) throw new AckError(reply.code, reply.message);
    return reply.data;
  }

  /** Emit with ack and return the raw `Ack<T>` for error-path assertions. */
  async callRaw<T>(event: string, payload?: unknown): Promise<Ack<T>> {
    return (await this.socket.timeout(5000).emitWithAck(event, payload)) as Ack<T>;
  }

  /** Resolve with the next `event` payload (2s timeout). */
  next<T>(event: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 2000);
      this.socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** Collect every `event` payload from now on (for ordered assertions). */
  collect<T>(event: string): T[] {
    const seen: T[] = [];
    this.socket.on(event, (payload: T) => seen.push(payload));
    return seen;
  }

  async connected(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("connect_error", reject);
    });
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}

export class AckError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AckError";
  }
}

export async function startTestServer(options: AppOptions = {}): Promise<TestServer> {
  const app = buildApp(options);
  const port = await app.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const clients: TestClient[] = [];
  return {
    app,
    url,
    client(headers?: Record<string, string>) {
      const socket = connect(url, {
        transports: ["websocket"],
        auth: { protocolVersion: PROTOCOL_VERSION },
        ...(headers !== undefined ? { extraHeaders: headers } : {}),
      });
      const client = new TestClient(socket);
      clients.push(client);
      return client;
    },
    async close() {
      for (const c of clients) c.disconnect();
      await app.close();
    },
  };
}
