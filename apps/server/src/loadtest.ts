/**
 * Load smoke test: N concurrent rooms of socket-driven bots playing full
 * games against one server instance (in-process by default, or a remote
 * URL via LOADTEST_URL). Bots are real Socket.IO clients that act on the
 * public protocol only — they play whenever game:timer names them leader.
 *
 * Run: pnpm --filter @deckxi/server loadtest   (after a build)
 */
import { io as connect, type Socket } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  type Ack,
  type RedactedGameEvent,
  type RoomJoined,
  type TurnTimerView,
} from "@deckxi/shared";
import { buildApp, type App } from "./app.js";

export interface LoadTestOptions {
  rooms: number;
  playersPerRoom: number;
  /** Per-room completion deadline. */
  roomTimeoutMs: number;
  /** Target an already-running server instead of an in-process one. */
  url?: string;
}

export interface LoadTestSummary {
  rooms: number;
  completed: number;
  failed: { room: number; reason: string }[];
  totalRounds: number;
  totalEvents: number;
  wallMs: number;
}

async function call<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  const reply = (await socket.timeout(10_000).emitWithAck(event, payload)) as Ack<T>;
  if (!reply.ok) throw new Error(`${event} → ${reply.code}: ${reply.message}`);
  return reply.data;
}

function bot(url: string): Socket {
  return connect(url, {
    transports: ["websocket"],
    auth: { protocolVersion: PROTOCOL_VERSION },
    reconnection: false,
  });
}

async function connected(socket: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

/** One room: create, fill with bots, play to GAME_ENDED, report stats. */
async function runRoom(
  url: string,
  roomIndex: number,
  playersPerRoom: number,
  timeoutMs: number,
): Promise<{ rounds: number; events: number }> {
  const sockets: Socket[] = [];
  try {
    return await new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`room ${roomIndex} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      let rounds = 0;
      let events = 0;

      const finish = (): void => {
        clearTimeout(deadline);
        resolve({ rounds, events });
      };

      const wire = (socket: Socket, selfId: string): void => {
        let statKeys: string[] = [];
        let currentTimer: TurnTimerView | null = null;

        // Play whenever the live timer names us leader. A stale-timer race
        // gets a command-rejected ack (ignored); a rate-limited ack — bots
        // outpace the per-socket bucket in a long leader streak — retries
        // once the bucket has refilled a token.
        const act = (): void => {
          if (currentTimer === null || currentTimer.playerId !== selfId) return;
          if (statKeys.length === 0) return;
          const stat = statKeys[Math.floor(Math.random() * statKeys.length)] as string;
          const deadline = currentTimer.deadline;
          socket.emit("game:selectStat", { stat }, (reply: Ack<null>) => {
            if (!reply.ok && reply.code === "rate-limited" && currentTimer?.deadline === deadline) {
              setTimeout(act, 250);
            }
          });
        };

        socket.on("game:events", (batch: RedactedGameEvent[]) => {
          events += batch.length;
          for (const event of batch) {
            if (event.type === "GAME_STARTED") statKeys = event.config.stats.map((s) => s.key);
            if (event.type === "ROUND_RESOLVED") rounds++;
            if (event.type === "GAME_ENDED") finish();
          }
        });
        socket.on("game:timer", (timer: TurnTimerView | null) => {
          currentTimer = timer;
          act();
        });
      };

      void (async () => {
        const host = bot(url);
        sockets.push(host);
        await connected(host);
        const joined = await call<RoomJoined>(host, "room:create", {
          name: `Bot-${roomIndex}-0`,
          settings: { cardsPerPlayer: 3, turnTimerSeconds: 30, maxRounds: 100 },
        });
        wire(host, joined.selfId);

        for (let p = 1; p < playersPerRoom; p++) {
          const socket = bot(url);
          sockets.push(socket);
          await connected(socket);
          const j = await call<RoomJoined>(socket, "room:join", {
            code: joined.room.code,
            name: `Bot-${roomIndex}-${p}`,
          });
          wire(socket, j.selfId);
          await call(socket, "room:ready", { ready: true });
        }
        await call(host, "room:start");
      })().catch(reject);
    });
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

export async function runLoadTest(options: LoadTestOptions): Promise<LoadTestSummary> {
  let app: App | null = null;
  let url = options.url;
  if (url === undefined) {
    app = buildApp({ rooms: { maxRooms: options.rooms + 10 } });
    const port = await app.listen(0);
    url = `http://127.0.0.1:${port}`;
  }

  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: options.rooms }, (_, i) =>
      runRoom(url, i, options.playersPerRoom, options.roomTimeoutMs),
    ),
  );
  const wallMs = Date.now() - start;
  await app?.close();

  const summary: LoadTestSummary = {
    rooms: options.rooms,
    completed: 0,
    failed: [],
    totalRounds: 0,
    totalEvents: 0,
    wallMs,
  };
  results.forEach((result, room) => {
    if (result.status === "fulfilled") {
      summary.completed++;
      summary.totalRounds += result.value.rounds;
      summary.totalEvents += result.value.events;
    } else {
      summary.failed.push({ room, reason: String(result.reason) });
    }
  });
  return summary;
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);

if (isMain) {
  const options: LoadTestOptions = {
    rooms: Number(process.env["LOADTEST_ROOMS"] ?? 50),
    playersPerRoom: Number(process.env["LOADTEST_PLAYERS"] ?? 4),
    roomTimeoutMs: Number(process.env["LOADTEST_TIMEOUT_MS"] ?? 120_000),
    ...(process.env["LOADTEST_URL"] !== undefined ? { url: process.env["LOADTEST_URL"] } : {}),
  };
  console.log(
    `load test: ${options.rooms} rooms × ${options.playersPerRoom} bots` +
      (options.url === undefined ? " (in-process server)" : ` → ${options.url}`),
  );
  const summary = await runLoadTest(options);
  console.log(
    `completed ${summary.completed}/${summary.rooms} rooms in ${(summary.wallMs / 1000).toFixed(1)}s — ` +
      `${summary.totalRounds} rounds, ${summary.totalEvents} events ` +
      `(${Math.round(summary.totalEvents / (summary.wallMs / 1000))} events/s)`,
  );
  for (const failure of summary.failed) {
    console.error(`  room ${failure.room} failed: ${failure.reason}`);
  }
  process.exit(summary.failed.length === 0 ? 0 : 1);
}
