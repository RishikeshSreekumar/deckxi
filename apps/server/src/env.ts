/**
 * Environment parsing — fail fast and loudly on a bad config.
 */
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  /** Optional until Phase 7 — without it match persistence is in-memory. */
  DATABASE_URL: z.string().url().optional(),
  /** Comma-separated allowed web origins for CORS / websocket upgrades. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});

export interface Env {
  port: number;
  host: string;
  databaseUrl: string | undefined;
  corsOrigins: string[];
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  };
}
