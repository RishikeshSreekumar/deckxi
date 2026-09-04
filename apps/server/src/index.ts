/**
 * @deckxi/server — Fastify + Socket.IO realtime game server (authoritative).
 * Entry point: parse env, assemble the app, listen, shut down cleanly.
 */
import { APP_NAME, PROTOCOL_VERSION } from "@deckxi/shared";
import { buildApp } from "./app.js";
import { parseEnv } from "./env.js";
import { loggerOptions, type Logger } from "./logging.js";
import { installProcessHandlers } from "./errors.js";
import { createMagicLinkSender } from "./mail.js";
import pino from "pino";

export function serverInfo(): string {
  return `${APP_NAME} server (protocol v${PROTOCOL_VERSION})`;
}

export { buildApp } from "./app.js";
export { parseEnv } from "./env.js";

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);

if (isMain) {
  const { createConfigStore, createStore } = await import("./db/index.js");
  const env = parseEnv();
  const store = createStore(env.databaseUrl);
  // One logger instance, shared: Fastify takes it as-is, and the mailer needs
  // it before the app exists so its "no mail configured" complaint lands in
  // the same stream as everything else.
  const log = pino(
    loggerOptions({ level: env.logLevel, appEnv: env.appEnv, release: env.release }),
  );
  const sendMagicLink = createMagicLinkSender({
    apiKey: env.mail.apiKey,
    from: env.mail.from,
    isDeployment: env.appEnv !== "development",
    log,
  });
  const app = buildApp({
    corsOrigins: env.corsOrigins,
    // Fastify 5 accepts a pre-built pino instance only as `loggerInstance`.
    loggerInstance: log,
    store,
    config: createConfigStore(store),
    auth: {
      databaseUrl: env.databaseUrl,
      ...(env.authSecret !== undefined ? { secret: env.authSecret } : {}),
      baseURL: env.authUrl ?? `http://localhost:${env.port}`,
      google: env.google,
      ...(sendMagicLink !== undefined ? { sendMagicLink } : {}),
    },
    admin: { token: env.adminToken, emails: env.adminEmails },
    captchaSecret: env.captchaSecret,
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
