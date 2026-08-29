/**
 * Socket.IO wiring: validates every inbound message against its shared Zod
 * schema, maps sessions ↔ sockets, and relays RoomManager callbacks to the
 * right rooms. All game rules live in the manager; this file is transport.
 */
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

const roomKey = (roomId: string): string => `room:${roomId}`;

function toAckError(error: unknown): { ok: false; code: ErrorCode; message: string } {
  if (error instanceof RoomError) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: "bad-request", message: "internal error" };
}

export function registerSockets(io: GameServer, options: RoomManagerOptions = {}): RoomManager {
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
  };

  const manager = new RoomManager(observer, options);

  io.on("connection", (socket) => {
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
          } catch (error) {
            ack(toAckError(error));
          }
        },
      );
    };

    const attach = (room: Room, session: Session): RoomJoined => {
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
      const { room, session } = manager.createRoom(payload.name, payload.settings ?? {});
      return attach(room, session);
    });

    on("room:join", (payload: { code: string; name: string; spectator?: boolean }) => {
      if (socket.data.sessionId !== null) throw new RoomError("already-in-room");
      const { room, session } = manager.joinRoom(payload.code, payload.name, payload.spectator);
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

    socket.on("disconnect", () => {
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
