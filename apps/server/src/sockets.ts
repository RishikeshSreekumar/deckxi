/**
 * Socket.IO wiring: validates every inbound message against its shared Zod
 * schema, maps sessions ↔ sockets, and relays RoomManager callbacks to the
 * right rooms. All game rules live in the manager; this file is transport.
 */
import type { EMOTES } from "@deckxi/shared";
import {
  clientMessageSchemas,
  type Ack,
  type ClientMessageName,
  type ErrorCode,
  type RoomJoined,
  type RoomSettings,
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
import { nullLogger, type Logger } from "./logging.js";
import { createMetrics, type Metrics } from "./metrics.js";
import type { OpsConfig } from "./ops.js";

const roomKey = (roomId: string): string => `room:${roomId}`;

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
}

export function registerSockets(io: GameServer, options: SocketOptions = {}): RoomManager {
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const log = options.logger ?? nullLogger;
  const metrics = options.metrics ?? createMetrics();
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
      const editionId = room.game?.editionId ?? room.settings.editionId;
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
          events.map((e) => redactEvent(e, viewerId, editionId)),
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
    const on = <T>(event: ClientMessageName, handler: (payload: never) => T): void => {
      (socket as unknown as { on(e: string, f: (p: unknown, a: unknown) => void): void }).on(
        event,
        (payload, ackRaw) => {
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
            ack({ ok: true, data: handler(parsed.data as never) ?? null });
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
      socket.data.sessionId = session.id;
      socket.data.roomId = room.id;
      socketBySession.set(session.id, socket);
      socketLog = log.child({
        socketId: socket.id,
        userId: socket.data.userId,
        roomId: room.id,
        sessionId: session.id,
      });
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

    on("room:create", (payload: { name: string; settings?: Partial<RoomSettings> }) => {
      if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
      const { room, session } = manager.createRoom(
        payload.name,
        payload.settings ?? {},
        socket.data.userId,
      );
      return attach(room, session);
    });

    on("room:join", (payload: { code: string; name: string; spectator?: boolean }) => {
      if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
      const { room, session } = manager.joinRoom(
        payload.code,
        payload.name,
        payload.spectator,
        socket.data.userId,
      );
      return attach(room, session);
    });

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
        events: game !== null ? redactLog(game.log, viewerId, game.editionId) : [],
        timer:
          game !== null && room.phase === "playing" && game.turnDeadline !== null
            ? { playerId: game.state.leader, deadline: game.turnDeadline }
            : null,
      };
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

    on("game:selectStat", (payload: { stat: string }) => {
      manager.selectStat(requireSessionId(), payload.stat);
      return null;
    });

    on("game:forfeit", () => {
      manager.forfeit(requireSessionId());
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
