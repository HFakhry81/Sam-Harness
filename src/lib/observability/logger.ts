/**
 * Structured logging via pino — includes run/trace ids when set on AsyncLocalStorage.
 */
import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";

export type LogContext = {
  runId?: string;
  traceId?: string;
  tenantId?: string;
  span?: string;
};

const als = new AsyncLocalStorage<LogContext>();

const level = String(process.env.LOG_LEVEL || "info").toLowerCase();

export const rootLogger = pino({
  level: ["fatal", "error", "warn", "info", "debug", "trace"].includes(level)
    ? level
    : "info",
  base: { service: "sam-harness" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export function createLogger(name: string) {
  return rootLogger.child({ module: name });
}

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = als.getStore() || {};
  return als.run({ ...parent, ...ctx }, fn);
}

export async function runWithLogContextAsync<T>(
  ctx: LogContext,
  fn: () => Promise<T>
): Promise<T> {
  const parent = als.getStore() || {};
  return als.run({ ...parent, ...ctx }, fn);
}

export function getLogContext(): LogContext {
  return als.getStore() || {};
}

/** Child logger enriched with current run/trace ids. */
export function boundLogger(name: string) {
  const ctx = getLogContext();
  return rootLogger.child({
    module: name,
    runId: ctx.runId,
    traceId: ctx.traceId,
    tenantId: ctx.tenantId,
  });
}
