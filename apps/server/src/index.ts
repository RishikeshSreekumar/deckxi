/**
 * @deckxi/server — Fastify + Socket.IO realtime game server (authoritative).
 * Entry point: parse env, assemble the app, listen, shut down cleanly.
 */
import { APP_NAME, PROTOCOL_VERSION } from "@deckxi/shared";
import { buildApp } from "./app.js";
import { parseEnv } from "./env.js";
import { loggerOptions, type Logger } from "./logging.js";
import { installProcessHandlers } from "./errors.js";

export function serverInfo(): string {
  return `${APP_NAME} server (protocol v${PROTOCOL_VERSION})`;
}

export { buildApp } from "./app.js";
export { parseEnv } from "./env.js";

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);

if (isMain) {
  const { createStore } = await import("./db/index.js");
  const env = parseEnv();
  const app = buildApp({
    corsOrigins: env.corsOrigins,
    logger: loggerOptions({
      level: env.logLevel,
      appEnv: env.appEnv,
      release: env.release,
    }),
    store: createStore(env.databaseUrl),
    auth: {
      databaseUrl: env.databaseUrl,
      ...(env.authSecret !== undefined ? { secret: env.authSecret } : {}),
      baseURL: env.authUrl ?? `http://localhost:${env.port}`,
      google: env.google,
    },
    admin: { token: env.adminToken },
  });
  installProcessHandlers(app.fastify.log as unknown as Logger);
  const port = await app.listen(env.port, env.host);
  app.fastify.log.info(
    { event: "server.started", port, release: env.release ?? null },
    `${serverInfo()} listening on :${port}`,
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}
