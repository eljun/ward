import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { WardEvent } from "@ward/core";
import type { WardPaths } from "./layout.ts";
import { ensureWardLayout, resolveWardPaths } from "./layout.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  readonly filePath: string;
  write(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  event(event: WardEvent): void;
};

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createLogger(paths: WardPaths = resolveWardPaths()): Promise<Logger> {
  await ensureWardLayout(paths);
  const filePath = join(paths.logsDir, `ward-${dateStamp()}.ndjson`);

  return {
    filePath,
    write(level, message, fields = {}) {
      appendFileSync(filePath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...fields
      })}\n`);
    },
    event(event) {
      appendFileSync(filePath, `${JSON.stringify({ kind: "event", ...event })}\n`);
    }
  };
}
