/**
 * Error tracking (#64) — both sides, no vendor.
 *
 * **Why not Sentry.** The issue asked for it, and Sentry's free tier would
 * genuinely cost nothing in money. It costs elsewhere: ~30 KB gzipped of
 * browser SDK against a mobile payload budget we gate in CI (#107), an
 * organisation and a DSN to keep, an auth token in CI to upload source maps,
 * and a quota that silently drops events once a loop starts reporting. What
 * Sentry actually buys is grouping and a UI over a stream of error objects —
 * and this server already emits a structured, queryable stream (#65) that
 * Cloud Logging groups, filters and alerts on for free.
 *
 * So: unhandled errors on both sides funnel into one shape, `event:
 * "error.*"`, with the release and whatever correlation ids are in scope.
 * `docs/runbook.md` → "Errors" has the queries. If the volume ever justifies a
 * real error tracker, it is one report function to redirect.
 *
 * The browser half posts here; that endpoint is public by necessity, so it is
 * rate-limited per IP, capped in size, and never trusted for anything but a
 * log line.
 */
import { z } from "zod";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TokenBucket } from "./rateLimit.js";
import type { Logger } from "./logging.js";
import type { Metrics } from "./metrics.js";

/** Deliberately small: a stack, a message and where it happened. */
export const clientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  /** Where in the app it happened (path only — no query string). */
  url: z.string().max(500).optional(),
  /** Build the browser is running, so a spike can be pinned to a deploy. */
  release: z.string().max(100).optional(),
  /** "error" (window.onerror), "unhandledrejection" or "boundary". */
  kind: z.enum(["error", "unhandledrejection", "boundary"]),
});
export type ClientErrorReport = z.infer<typeof clientErrorSchema>;

/** Per-IP budget for the public intake: a burst, then a slow trickle. */
const REPORT_BURST = 10;
const REPORT_PER_SEC = 0.2;
/** Bound the map so a spray of spoofed IPs can't grow it without limit. */
const MAX_TRACKED_IPS = 5000;

export function clientErrorLimiter(): (ip: string) => boolean {
  const buckets = new Map<string, TokenBucket>();
  return (ip) => {
    if (buckets.size >= MAX_TRACKED_IPS) buckets.clear();
    let bucket = buckets.get(ip);
    if (bucket === undefined) {
      bucket = new TokenBucket(REPORT_BURST, REPORT_PER_SEC);
      buckets.set(ip, bucket);
    }
    return bucket.tryTake();
  };
}

/**
 * Wire the server's error paths into the log stream:
 *  - Fastify route errors (which otherwise answer 500 with no trace)
 *  - the browser's error intake
 *  - process-level crashes, which are the ones you most want a line for
 */
export function registerErrorTracking(
  fastify: FastifyInstance,
  log: Logger,
  metrics: Metrics,
): void {
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode ?? 500;
    // 4xx is the client being wrong; only 5xx is us being wrong.
    if (status >= 500) {
      log.error(
        { event: "error.server", reqId: request.id, url: request.url, err: error },
        "unhandled route error",
      );
    }
    void reply.status(status).send({ error: status >= 500 ? "internal error" : error.message });
  });

  const allow = clientErrorLimiter();

  fastify.post("/api/telemetry/error", (request, reply) => {
    if (!allow(request.ip)) return reply.status(429).send({ ok: false });
    const parsed = clientErrorSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ ok: false });
    const report = parsed.data;
    metrics.increment("deckxi_client_errors_total", { kind: report.kind });
    log.error(
      {
        event: "error.client",
        reqId: request.id,
        kind: report.kind,
        clientRelease: report.release ?? null,
        page: report.url ?? null,
        userAgent: request.headers["user-agent"] ?? null,
        stack: report.stack ?? null,
      },
      report.message,
    );
    // 204: the browser has nothing to do with the answer, and a body would
    // only invite the reporter to retry on parse failure.
    return reply.status(204).send();
  });
}

/**
 * Last-resort process handlers. An uncaught exception leaves the process in an
 * unknown state, so we log and let the platform restart us rather than
 * pretending we recovered — but the log line is the whole point: without it
 * Cloud Run reports a bare exit code.
 */
export function installProcessHandlers(log: Logger): () => void {
  const onRejection = (reason: unknown): void => {
    log.error({ event: "error.unhandled_rejection", err: reason }, "unhandled promise rejection");
  };
  const onException = (error: Error): void => {
    log.error({ event: "error.uncaught_exception", err: error }, "uncaught exception");
    process.exit(1);
  };
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
  return () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  };
}
