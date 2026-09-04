# ADR 0002 — A room is owned by one instance; the cluster forwards, it does not share

Status: accepted (Phase 10, 2026-09-04)

## Context

Through Phase 9 the server ran as exactly one process, and PLAN.md said so: WebSockets need a
long-lived process, and a single instance means no sticky-session problem and no shared state.
Phase 10 (#86) asks for that ceiling to come off.

A `RoomManager` holds room state, turn timers and the event log in memory, and every rule in the
game assumes it can act on that state synchronously — `applyEngineCommand` reads the state,
appends events, reschedules the clock and broadcasts, all in one tick.

Two ways to run more than one instance:

1. **Externalise room state.** Every command re-derives state from Redis behind a lock, writes it
   back, and broadcasts. Any instance can serve any player.
2. **Keep the room in one process** and route messages to the instance that owns it.

## Decision

Option 2. A room belongs to the instance that created it, for its whole life.

- A **directory** (`deckxi:room:code:*` in Redis, `SET NX`) maps join code → owning instance, and
  makes a code unique across the cluster rather than merely unique per process.
- A **bus** (Redis pub/sub, request/reply with a timeout) carries a player's message from the
  instance holding their socket to the instance holding their room, and carries that room's events
  back to the socket.
- The Socket.IO Redis adapter is wired too, but only for genuinely process-wide broadcasts (the
  maintenance banner). Room traffic never uses it: a room's members may be spread across instances,
  so every room event fans out per session rather than through `io.to(room)`.

Without `REDIS_URL` all of this is a cluster of one: the in-memory directory and bus, and behaviour
byte-for-byte identical to before.

## Why not shared state

The property the game depends on is that exactly one process decides what a room does. Turn timers,
auto-play on expiry, forfeit-on-disconnect and the event log's sequence numbers are all written
assuming a single writer. Option 1 does not remove that requirement — it replaces it with a
distributed lock held across every command, which is the same constraint with more moving parts and
a new class of failure (a lock lost mid-command leaves a half-applied game).

Option 2's cost is one network hop for a player who lands on the wrong instance. Sticky routing at
the edge, where the platform offers it, removes even that; nothing in the design depends on having it.

## Consequences

- **An instance dying takes its rooms with it.** That was already true, and is why the directory's
  entries expire: a stale pointer would send players to a machine that would only deny the room.
- **Quick match stays per instance.** Pairing across instances would seat players in a room only one
  of them can reach without forwarding, and the queue is cheap to keep local. Revisit if a single
  instance's queue is routinely empty while another's is not.
- **The forwarding surface is deliberately narrow.** Only room and game commands, chat, joins,
  resumes and disconnects cross an instance boundary, and each maps onto something a local socket
  could already ask for. The session id is minted by the owner, so nothing the sender claims about
  identity is trusted.
- **Two instances are testable in CI.** The in-memory bus and directory let two whole servers run in
  one process and behave as two machines sharing Redis (`cluster.test.ts`).
