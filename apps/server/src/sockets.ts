/**
 * Socket.IO wiring: validates every inbound message against its shared Zod
 * schema, maps sessions ↔ sockets, and relays RoomManager callbacks to the
 * right rooms. All game rules live in the manager; this file is transport.
 */
import type { EMOTES, GameModeId, QueueStatusView } from "@deckxi/shared";
import {
  clientMessageSchemas,
  type Ack,
  type ClientMessageName,
  type ErrorCode,
  type GameCommandPayload,
  type PowerPlayView,
  type RoomJoined,
  type RoomSettings,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
} from "@deckxi/shared";
import type { GameServer, GameSocket } from "./app.js";
import {
  RoomError,
  RoomManager,
  toRoomView,
  type Room,
  type RoomManagerOptions,
  type RoomsObserver,
  type Session,
} from "./rooms.js";
import { redactEvent, redactLog, type SeqEvent } from "./redact.js";
import { DEFAULT_LIMITS, TokenBucket, type RateLimits } from "./rateLimit.js";
import { clientIp, quotaKeys, Quotas } from "./quota.js";
import { DEFAULT_BOT_WAIT_MS, Matchmaker } from "./matchmaking.js";
import { getMode } from "@deckxi/engine";
import type { CaptchaVerifier } from "./captcha.js";
import { nullLogger, type Logger } from "./logging.js";
import { createMetrics, type Metrics } from "./metrics.js";
import type { OpsConfig } from "./ops.js";

const roomKey = (roomId: string): string => `room:${roomId}`;

/** Names for backfilled seats — a bot at the table should read as one. */
const BOT_NAMES = ["Nightwatch (bot)", "Googly (bot)", "Yorker (bot)", "Slip (bot)"] as const;

function toAckError(error: unknown): { ok: false; code: ErrorCode; message: string } {
  if (error instanceof RoomError) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: "bad-request", message: "internal error" };
}

export interface SocketOptions {
  rooms?: RoomManagerOptions | undefined;
  limits?: Partial<RateLimits> | undefined;
  logger?: Logger | undefined;
  metrics?: Metrics | undefined;
  /** Live ops flags: maintenance notice and mode kill switches (#70). */
  ops?: OpsConfig | undefined;
  /**
   * The account's current display name for this socket, looked up fresh —
   * the landing form may have renamed the account a moment before joining,
   * after the handshake snapshot was taken. Null when there is no account.
   */
  resolveName?: ((socket: GameSocket) => Promise<string | null>) | undefined;
  /** Per-source abuse quotas (#87). Shared with the HTTP layer. */
  quotas?: Quotas | undefined;
  /** Turnstile, when this deployment has it configured (#87). */
  captcha?: CaptchaVerifier | undefined;
  /** Quick match (#81): how long to look for a human before seating bots. */
  botWaitMs?: number | undefined;
}

export function registerSockets(io: GameServer, options: SocketOptions = {}): RoomManager {
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const log = options.logger ?? nullLogger;
  const metrics = options.metrics ?? createMetrics();
  const quotas = options.quotas ?? new Quotas();
  const captcha = options.captcha ?? null;
  const socketBySession = new Map<string, GameSocket>();

  const detachRoom = (room: Room): void => {
    for (const session of [...room.players, ...room.spectators]) {
      const socket = socketBySession.get(session.id);
      if (socket !== undefined) {
        socket.data.sessionId = null;
        socket.data.roomId = null;
        void socket.leave(roomKey(room.id));
        socketBySession.delete(session.id);
      }
    }
  };

  const observer: RoomsObserver = {
    roomState(room) {
      io.to(roomKey(room.id)).emit("room:state", toRoomView(room));
    },
    roomClosed(room, reason) {
      io.to(roomKey(room.id)).emit("room:closed", { reason });
      detachRoom(room);
    },
    gameEvents(room, events: SeqEvent[]) {
      const game = room.game;
      if (game === null) return;
      const editionId = game.editionId;
      for (const { seq, event } of events) {
        // Debug level: on stdout this is off in a deployment, but the ops
        // feed tees before the level filter, so the dashboard still sees
        // every move (#68).
        log.debug(
          {
            event: "game.event",
            roomId: room.id,
            matchId: room.game?.matchId ?? null,
            type: event.type,
            seq,
          },
          event.type,
        );
      }
      for (const session of [...room.players, ...room.spectators]) {
        const socket = socketBySession.get(session.id);
        if (socket === undefined) continue;
        const viewerId = session.spectator ? null : session.id;
        socket.emit(
          "game:events",
          events.map((e) => redactEvent(game.mode, e, viewerId, editionId)),
        );
      }
    },
    timer(room, timer) {
      io.to(roomKey(room.id)).emit("game:timer", timer);
    },
    sessionKicked(room, session) {
      // Told before they are removed, so the client can say why rather than
      // silently finding itself back on the landing page (#70).
      const socket = socketBySession.get(session.id);
      if (socket === undefined) return;
      socket.emit("room:closed", { reason: "kicked" });
      socket.data.sessionId = null;
      socket.data.roomId = null;
      void socket.leave(roomKey(room.id));
      socketBySession.delete(session.id);
    },
  };

  const manager = new RoomManager(observer, options.rooms);

  /**
   * Bind a socket to a room session. Shared by the ordinary create/join
   * handlers and by quick match, which seats sockets that are not the one
   * currently handling a message.
   */
  const attachTo = (socket: GameSocket, room: Room, session: Session): RoomJoined => {
    socket.data.sessionId = session.id;
    socket.data.roomId = room.id;
    socketBySession.set(session.id, socket);
    void socket.join(roomKey(room.id));
    return {
      protocolVersion: PROTOCOL_VERSION,
      roomId: room.id,
      selfId: session.id,
      spectator: session.spectator,
      resumeToken: session.resumeToken,
      room: toRoomView(room),
    };
  };

  const botName = (index: number): string => BOT_NAMES[index % BOT_NAMES.length] as string;

  // -------------------------------------------------------------------------
  // Quick match (#81). The queue holds sockets; seating one is creating a room
  // for the first and joining the rest to it, so from the moment a table is
  // made it is an ordinary room and nothing downstream knows the difference.
  // -------------------------------------------------------------------------
  const botWaitMs = options.botWaitMs ?? DEFAULT_BOT_WAIT_MS;
  const queuedNames = new Map<GameSocket, string>();
  const matchmaker = new Matchmaker<GameSocket>({
    minPlayers: (mode) => getMode(mode).players.min,
    botWaitMs,
    now: () => Date.now(),
  });

  const queueStatus = (mode: GameModeId): QueueStatusView => {
    const waiting = matchmaker.waiting(mode);
    const oldest = waiting[0]?.joinedAt ?? Date.now();
    return { gameMode: mode, waiting: waiting.length, botsAt: oldest + botWaitMs };
  };

  const broadcastQueue = (mode: GameModeId): void => {
    const status = queueStatus(mode);
    for (const entry of matchmaker.waiting(mode)) entry.client.emit("queue:status", status);
  };

  /**
   * Seat one pairing. A socket that vanished between queueing and seating is
   * skipped rather than allowed to hold up the table; if that leaves nobody,
   * the room is closed again rather than left as litter.
   */
  const seat = (pairing: { mode: GameModeId; clients: GameSocket[]; bots: number }): void => {
    const live = pairing.clients.filter((socket) => socket.connected);
    if (live.length === 0) return;
    const [first, ...rest] = live as [GameSocket, ...GameSocket[]];
    let room: Room;
    let hostSession: Session;
    try {
      const created = manager.createRoom(
        queuedNames.get(first) ?? "Player",
        { gameMode: pairing.mode },
        first.data.userId,
      );
      room = created.room;
      hostSession = created.session;
    } catch (error) {
      // Server full, or the mode was killed while they waited. Say so rather
      // than leaving them staring at a spinner.
      for (const socket of live)
        socket.emit("queue:status", { ...queueStatus(pairing.mode), waiting: 0 });
      log.warn({ event: "queue.seatFailed", err: error }, "could not seat a queue");
      return;
    }
    // Everyone is bound first and told afterwards: the payload carries a room
    // snapshot, and a player who learned about the table before the rest of it
    // existed would open on a lobby missing their opponents.
    const seated: { socket: GameSocket; joined: RoomJoined }[] = [
      { socket: first, joined: attachTo(first, room, hostSession) },
    ];
    for (const socket of rest) {
      const joined = manager.joinRoom(
        room.code,
        queuedNames.get(socket) ?? "Player",
        false,
        socket.data.userId,
      );
      manager.setReady(joined.session.id, true);
      seated.push({ socket, joined: attachTo(socket, room, joined.session) });
    }
    for (let i = 0; i < pairing.bots; i++) manager.addBot(room.id, botName(i));
    for (const socket of live) queuedNames.delete(socket);
    const view = toRoomView(room);
    for (const { socket, joined } of seated)
      socket.emit("queue:matched", { ...joined, room: view });

    metrics.increment("deckxi_quickmatch_tables_total", { bots: String(pairing.bots) });
    log.info(
      {
        event: "queue.matched",
        roomId: room.id,
        mode: pairing.mode,
        players: live.length,
        bots: pairing.bots,
      },
      "quick match seated a table",
    );
    // The host starts it: everyone here asked for a game, and the lobby has
    // nothing left to decide.
    try {
      manager.startGame(hostSession.id);
    } catch (error) {
      log.warn(
        { event: "queue.startFailed", roomId: room.id, err: error },
        "quick match could not start",
      );
    }
  };

  const sweep = setInterval(() => {
    for (const pairing of matchmaker.takeAll()) seat(pairing);
  }, 1000);
  sweep.unref();

  // Maintenance notice: pushed to everyone the moment it changes, and to each
  // new connection below, so a player who arrives mid-incident is told the
  // same thing as one who was already here (#70).
  options.ops?.subscribe((flags) => {
    io.emit("ops:notice", flags.notice);
  });

  io.on("connection", (socket) => {
    // Every line from this connection carries who and where, so one player's
    // whole session can be pulled out of the stream by socketId (#65).
    let socketLog = log.child({ socketId: socket.id, userId: socket.data.userId });
    const ip = clientIp(socket.handshake.headers, socket.handshake.address);
    // One IP holding dozens of sockets is a script, not a household. Refused
    // at the door: nothing this connection could ask for is worth the memory.
    if (!quotas.connections.add(ip)) {
      metrics.increment("deckxi_quota_rejections_total", { quota: "connections" });
      socketLog.warn({ event: "quota.connections", ip }, "too many connections from one address");
      socket.disconnect(true);
      return;
    }
    socket.on("disconnect", () => {
      quotas.connections.remove(ip);
    });
    socketLog.debug({ event: "socket.connected" }, "socket connected");
    metrics.increment("deckxi_socket_connections_total");
    const notice = options.ops?.current.notice ?? null;
    if (notice !== null) socket.emit("ops:notice", notice);

    const globalBucket = new TokenBucket(limits.global.capacity, limits.global.refillPerSec);
    const chatBucket = new TokenBucket(limits.chat.capacity, limits.chat.refillPerSec);
    const reactionBucket = new TokenBucket(
      limits.reactions.capacity,
      limits.reactions.refillPerSec,
    );
    /**
     * Register one message handler: require an ack callback, validate the
     * payload, run, and answer `Ack<T>` — RoomErrors become error acks.
     */
    const on = <T>(event: ClientMessageName, handler: (payload: never) => T | Promise<T>): void => {
      (socket as unknown as { on(e: string, f: (p: unknown, a: unknown) => void): void }).on(
        event,
        async (payload, ackRaw) => {
          if (typeof ackRaw !== "function") return;
          const ack = ackRaw as (reply: Ack<T | null>) => void;
          if (!globalBucket.tryTake()) {
            ack({ ok: false, code: "rate-limited", message: "slow down" });
            return;
          }
          const parsed = clientMessageSchemas[event].safeParse(payload ?? undefined);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            ack({
              ok: false,
              code: "bad-request",
              message: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid payload",
            });
            return;
          }
          try {
            ack({ ok: true, data: (await handler(parsed.data as never)) ?? null });
            metrics.increment("deckxi_commands_total", { command: event });
          } catch (error) {
            if (error instanceof RoomError) {
              metrics.increment("deckxi_command_rejections_total", { code: error.code });
              // Expected: the player asked for something the rules refuse.
              socketLog.debug(
                { event: "command.rejected", command: event, code: error.code },
                error.message,
              );
            } else {
              metrics.increment("deckxi_command_failures_total");
              socketLog.error(
                { event: "command.failed", command: event, err: error },
                "handler threw",
              );
            }
            ack(toAckError(error));
          }
        },
      );
    };

    const attach = (room: Room, session: Session): RoomJoined => {
      socketLog = log.child({
        socketId: socket.id,
        userId: socket.data.userId,
        roomId: room.id,
        sessionId: session.id,
      });
      return attachTo(socket, room, session);
    };

    const detachSelf = (): void => {
      if (socket.data.sessionId !== null) socketBySession.delete(socket.data.sessionId);
      if (socket.data.roomId !== null) void socket.leave(roomKey(socket.data.roomId));
      socket.data.sessionId = null;
      socket.data.roomId = null;
    };

    const requireSessionId = (): string => {
      if (socket.data.sessionId === null) throw new RoomError("not-in-room");
      return socket.data.sessionId;
    };

    /**
     * The name at the table is the account's display name whenever the
     * socket carries one (the landing form syncs what you type into it);
     * the payload only stands in for a cookieless, one-off client.
     */
    const tableName = async (fallback: string): Promise<string> => {
      let account = socket.data.userName;
      if (options.resolveName !== undefined) {
        try {
          account = (await options.resolveName(socket)) ?? account;
        } catch {
          /* auth store hiccup — the handshake snapshot will do */
        }
      }
      const trimmed = account?.trim() ?? "";
      if (trimmed.length === 0) return fallback;
      socket.data.userName = trimmed;
      return trimmed.slice(0, MAX_NAME_LENGTH);
    };

    /** This socket's quota identity: the account when signed in, plus the IP. */
    const keys = (): string[] => quotaKeys(socket.data.userId, ip);

    /**
     * Spend one unit of a quota, or refuse. Both keys are charged so that
     * signing up a fresh guest per room buys nothing.
     */
    const spend = (
      counter: { take(key: string): boolean },
      quota: string,
      message: string,
    ): void => {
      let allowed = true;
      for (const key of keys()) if (!counter.take(key)) allowed = false;
      if (allowed) return;
      metrics.increment("deckxi_quota_rejections_total", { quota });
      socketLog.warn({ event: "quota.exceeded", quota, ip }, message);
      throw new RoomError("quota-exceeded", message);
    };

    /**
     * A source that has been guessing join codes is asked to prove it is a
     * person — but only where a CAPTCHA is configured. Without one there is
     * nothing to ask, so the quota refusal (above) is the whole answer.
     */
    const checkCaptcha = async (token: string | undefined): Promise<void> => {
      if (captcha === null) return;
      if (!keys().some((key) => quotas.suspicious(key))) return;
      if (token !== undefined && (await captcha.verify(token, ip))) {
        metrics.increment("deckxi_captcha_total", { result: "passed" });
        return;
      }
      metrics.increment("deckxi_captcha_total", {
        result: token === undefined ? "asked" : "failed",
      });
      throw new RoomError("captcha-required", "please confirm you're a person");
    };

    on(
      "room:create",
      async (payload: {
        name: string;
        settings?: Partial<RoomSettings>;
        captchaToken?: string;
      }) => {
        if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
        await checkCaptcha(payload.captchaToken);
        spend(
          quotas.createRooms,
          "create-rooms",
          "you've opened a lot of tables — try again later",
        );
        const { room, session } = manager.createRoom(
          await tableName(payload.name),
          payload.settings ?? {},
          socket.data.userId,
        );
        return attach(room, session);
      },
    );

    on(
      "room:join",
      async (payload: {
        code: string;
        name: string;
        spectator?: boolean;
        captchaToken?: string;
      }) => {
        if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
        await checkCaptcha(payload.captchaToken);
        const name = await tableName(payload.name);
        try {
          const { room, session } = manager.joinRoom(
            payload.code,
            name,
            payload.spectator,
            socket.data.userId,
          );
          return attach(room, session);
        } catch (error) {
          // A wrong code is the code-sweeping signal. Only "no such room"
          // counts: a full room or a game in progress means the guess was
          // right, and those have their own answers.
          if (error instanceof RoomError && error.code === "room-not-found") {
            let over = false;
            for (const key of keys()) if (!quotas.failedJoins.take(key)) over = true;
            if (over) {
              metrics.increment("deckxi_quota_rejections_total", { quota: "failed-joins" });
              socketLog.warn({ event: "quota.failedJoins", ip }, "join-code sweeping");
              throw new RoomError("quota-exceeded", "too many wrong codes — try again later");
            }
          }
          throw error;
        }
      },
    );

    on("room:resume", (payload: { roomId: string; resumeToken: string }) => {
      if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
      const { room, session } = manager.resume(payload.roomId, payload.resumeToken);

      // A zombie socket for the same session (e.g. a half-dead tab) is
      // superseded: detach it so its eventual disconnect can't forfeit us.
      const previous = socketBySession.get(session.id);
      if (previous !== undefined && previous !== socket) {
        previous.data.sessionId = null;
        previous.data.roomId = null;
        void previous.leave(roomKey(room.id));
        previous.disconnect(true);
      }

      const joined = attach(room, session);
      const game = room.game;
      const viewerId = session.spectator ? null : session.id;
      return {
        ...joined,
        events: game !== null ? redactLog(game.mode, game.log, viewerId, game.editionId) : [],
        timer: game !== null && room.phase === "playing" ? manager.timerView(game) : null,
      };
    });

    on("queue:join", (payload: { gameMode: GameModeId; name: string }) => {
      if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
      if (!(options.ops?.isModeEnabled(payload.gameMode) ?? true)) {
        throw new RoomError("mode-disabled", `${payload.gameMode} is switched off right now`);
      }
      queuedNames.set(socket, payload.name);
      matchmaker.join(payload.gameMode, socket);
      metrics.increment("deckxi_quickmatch_joins_total", { mode: payload.gameMode });
      // Check straight away: two people tapping at once should not wait for
      // the next tick, and the tick is what handles the bot deadline.
      const pairing = matchmaker.take(payload.gameMode);
      const status = queueStatus(payload.gameMode);
      if (pairing !== null) seat(pairing);
      else broadcastQueue(payload.gameMode);
      return status;
    });

    on("queue:leave", () => {
      matchmaker.leave(socket);
      queuedNames.delete(socket);
      return null;
    });

    on("room:leave", () => {
      manager.leave(requireSessionId());
      detachSelf();
      return null;
    });

    on("room:ready", (payload: { ready: boolean }) => {
      manager.setReady(requireSessionId(), payload.ready);
      return null;
    });

    on("room:settings", (payload: Partial<RoomSettings>) => {
      manager.updateSettings(requireSessionId(), payload);
      return null;
    });

    on("room:start", () => {
      manager.startGame(requireSessionId());
      return null;
    });

    on("room:rematch", () => {
      manager.rematch(requireSessionId());
      return null;
    });

    on(
      "game:selectStat",
      (payload: { stat: string; cardIndex?: number; power?: PowerPlayView | null }) => {
        manager.selectStat(requireSessionId(), payload.stat, {
          cardIndex: payload.cardIndex,
          power: payload.power,
        });
        return null;
      },
    );

    on("game:playCard", (payload: { cardIndex: number; power?: PowerPlayView | null }) => {
      manager.playCard(requireSessionId(), payload.cardIndex, payload.power ?? null);
      return null;
    });

    on("game:forfeit", () => {
      manager.forfeit(requireSessionId());
      return null;
    });

    /** Any mode's move; the mode decides whether it is one it speaks. */
    on("game:command", (payload: GameCommandPayload) => {
      manager.command(requireSessionId(), payload);
      return null;
    });

    /** Chat and reactions are open to players and spectators alike. */
    const chatContext = (): { roomId: string; from: { id: string; name: string } } => {
      const session = manager.getSession(requireSessionId());
      if (session === undefined) throw new RoomError("not-in-room");
      return { roomId: session.roomId, from: { id: session.id, name: session.name } };
    };

    on("chat:send", (payload: { text: string }) => {
      const { roomId, from } = chatContext();
      if (!chatBucket.tryTake()) throw new RoomError("rate-limited", "chat too fast");
      metrics.increment("deckxi_chat_messages_total");
      io.to(roomKey(roomId)).emit("chat:message", { from, text: payload.text, at: Date.now() });
      return null;
    });

    on("chat:react", (payload: { emote: (typeof EMOTES)[number] }) => {
      const { roomId, from } = chatContext();
      if (!reactionBucket.tryTake()) throw new RoomError("rate-limited", "reactions too fast");
      io.to(roomKey(roomId)).emit("chat:reaction", { from, emote: payload.emote, at: Date.now() });
      return null;
    });

    socket.on("disconnect", (reason) => {
      socketLog.debug({ event: "socket.disconnected", reason }, "socket disconnected");
      // Leaving the queue by closing the tab is the common case, not an edge.
      matchmaker.leave(socket);
      queuedNames.delete(socket);
      const sessionId = socket.data.sessionId;
      if (sessionId === null) return;
      // A resume may have superseded this socket already.
      if (socketBySession.get(sessionId) !== socket) return;
      socketBySession.delete(sessionId);
      manager.handleDisconnect(sessionId);
    });
  });

  return manager;
}
