/**
 * The Redis connection, and the three things it drives (#86): the room
 * directory, the instance bus, and the Socket.IO adapter.
 *
 * All of it is optional. With no `REDIS_URL` the server is a cluster of one —
 * which is exactly what a single Cloud Run instance is, and what every test
 * runs as — and none of this code executes.
 */
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { redisCluster, type Cluster, type RedisLike } from "./cluster.js";
import type { Logger } from "./logging.js";

export interface ConnectedCluster {
  cluster: Cluster;
  /** Socket.IO adapter, so `io.emit` reaches sockets on other instances. */
  adapter: ReturnType<typeof createAdapter>;
  close(): Promise<void>;
}

/**
 * Connect, or return null when Redis is not configured. A failure to reach a
 * *configured* Redis is fatal: running multi-instance without the directory
 * would let two instances mint the same join code and send players to the
 * wrong table, which is worse than refusing to boot.
 */
export async function connectCluster(
  url: string | undefined,
  log: Logger,
): Promise<ConnectedCluster | null> {
  if (url === undefined) return null;
  const client = createClient({ url });
  client.on("error", (error: unknown) => {
    log.error({ event: "redis.error", err: error }, "redis connection error");
  });
  await client.connect();

  // The adapter needs its own pair: a subscriber cannot issue commands, and
  // the bus and directory share the main connection.
  const pub = client.duplicate();
  const sub = client.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);

  const cluster = redisCluster(client as unknown as RedisLike);
  log.info({ event: "cluster.connected", instanceId: cluster.id }, "joined the cluster");

  return {
    cluster,
    adapter: createAdapter(pub, sub),
    async close() {
      await cluster.bus.close();
      await Promise.allSettled([pub.quit(), sub.quit(), client.quit()]);
    },
  };
}
