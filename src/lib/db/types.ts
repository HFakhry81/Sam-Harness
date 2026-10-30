export type SqlParams = Array<string | number | bigint | null | Uint8Array | Buffer>;

export type SqlRow = Record<string, unknown>;

export type SqlStatement = {
  run(...params: SqlParams): { changes: number; lastInsertRowid?: number | bigint };
  get(...params: SqlParams): SqlRow | undefined;
  all(...params: SqlParams): SqlRow[];
};

export type SqlDriver = {
  readonly kind: "sqlite" | "postgres";
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** Run multiple statements in a transaction when supported. */
  transaction<T>(fn: () => T): T;
  close(): void;
  /** Absolute path for SQLite file, or connection tag for Postgres. */
  readonly location: string;
};

export type DocKind =
  | "daily-ops"
  | "comms-drafts"
  | "project-memory"
  | "hybrid-profile"
  | "cost-ledger"
  | "task-lifecycle"
  | "controlplane-session"
  | "delivery-board"
  | "rollback-journal"
  | "approvals";

export type RunStatus =
  | "pending"
  | "running"
  | "checkpointed"
  | "completed"
  | "failed"
  | "cancelled";

export type RunRecord = {
  id: string;
  tenantId: string;
  threadId: string;
  mode: string;
  status: RunStatus;
  phase: string;
  checkpointStep: string | null;
  attempt: number;
  cancelRequested: boolean;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  idempotencyKey: string | null;
  meta: Record<string, unknown>;
};

export type RunEvent = {
  id: string;
  runId: string;
  tenantId: string;
  at: string;
  kind: string;
  name: string;
  status: "ok" | "error" | "info" | "start" | "end";
  durationMs?: number;
  costUsd?: number;
  detail?: Record<string, unknown>;
};

export type ApprovalRecord = {
  id: string;
  tenantId: string;
  kind: string;
  subject: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
  meta?: Record<string, unknown>;
};
