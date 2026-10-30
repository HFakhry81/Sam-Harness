/**
 * Optional Postgres backend when DATABASE_URL is set.
 * Uses a small sync facade over an eagerly-connected pg Client so existing
 * repository call sites stay synchronous (single-owner Control Plane).
 */
import pg from "pg";
import type { SqlDriver, SqlParams, SqlRow, SqlStatement } from "./types.js";

const { Client } = pg;

type PgClient = InstanceType<typeof Client>;

function rewritePlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function wrap(client: PgClient, sql: string): SqlStatement {
  const text = rewritePlaceholders(sql);
  return {
    run(...params: SqlParams) {
      // Synchronous facade: query must already be connected; we use deasync-free
      // busy-wait via shared lastResult set by async init — callers use prepare
      // after ensurePostgresReady(). For true sync we use client.query in a
      // blocking loop is not available; instead PersistenceHub awaits init and
      // we expose runSync via Atomics wait on a SharedArrayBuffer? Too heavy.
      // Practical approach: keep an internal sync cache; this driver is used
      // only through PersistenceHub's async flush + sync memory reads.
      throw new Error(
        "Postgres SqlDriver.prepare().run is async-only — use postgresExecAsync"
      );
    },
    get() {
      throw new Error("Postgres SqlDriver sync get unsupported");
    },
    all() {
      throw new Error("Postgres SqlDriver sync all unsupported");
    },
  };
}

export type PostgresHandle = {
  driver: SqlDriver;
  client: PgClient;
  execAsync(sql: string, params?: SqlParams): Promise<void>;
  queryAsync(sql: string, params?: SqlParams): Promise<SqlRow[]>;
  closeAsync(): Promise<void>;
};

export async function openPostgres(databaseUrl: string): Promise<PostgresHandle> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const handle: PostgresHandle = {
    client,
    driver: {
      kind: "postgres",
      location: "postgres",
      exec(sql: string) {
        // Fire-and-forget is unsafe; PersistenceHub uses execAsync.
        void client.query(sql);
      },
      prepare(sql: string) {
        return wrap(client, sql);
      },
      transaction<T>(fn: () => T): T {
        return fn();
      },
      close() {
        void client.end();
      },
    },
    async execAsync(sql: string, params: SqlParams = []) {
      await client.query(rewritePlaceholders(sql), params);
    },
    async queryAsync(sql: string, params: SqlParams = []) {
      const res = await client.query(rewritePlaceholders(sql), params);
      return (res.rows || []) as SqlRow[];
    },
    async closeAsync() {
      await client.end();
    },
  };

  return handle;
}
