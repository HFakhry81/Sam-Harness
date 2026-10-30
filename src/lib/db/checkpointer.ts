/**
 * LangGraph BaseCheckpointSaver backed by our SQLite SqlDriver
 * (same schema as @langchain/langgraph-checkpoint-sqlite).
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointTuple,
  type CheckpointMetadata,
  type PendingWrite,
  type SerializerProtocol,
  TASKS,
} from "@langchain/langgraph-checkpoint";
import type { SqlDriver } from "./types.js";
import { getDriver, getPersistence } from "./index.js";

export class SamSqliteSaver extends BaseCheckpointSaver {
  private ready = false;

  constructor(
    private readonly driver: SqlDriver,
    serde?: SerializerProtocol
  ) {
    super(serde);
  }

  static fromDriver(driver: SqlDriver = getDriver()): SamSqliteSaver {
    return new SamSqliteSaver(driver);
  }

  private setup(): void {
    if (this.ready) return;
    // Tables created by migrations; ensure present for isolated checkpointer use.
    this.driver.exec(`
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`);
    this.ready = true;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();
    const thread_id = config.configurable?.thread_id as string | undefined;
    const checkpoint_ns = String(config.configurable?.checkpoint_ns ?? "");
    const checkpoint_id = config.configurable?.checkpoint_id as string | undefined;
    if (!thread_id) return undefined;

    const row = checkpoint_id
      ? this.driver
          .prepare(
            `SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
          )
          .get(thread_id, checkpoint_ns, checkpoint_id)
      : this.driver
          .prepare(
            `SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1`
          )
          .get(thread_id, checkpoint_ns);

    if (!row) return undefined;

    const writes = this.driver
      .prepare(
        `SELECT task_id, channel, type, value FROM checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`
      )
      .all(thread_id, checkpoint_ns, String(row.checkpoint_id));

    const checkpoint = (await this.serde.loadsTyped(
      String(row.type || "json"),
      row.checkpoint as Uint8Array
    )) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(
      String(row.type || "json"),
      row.metadata as Uint8Array
    )) as CheckpointMetadata;

    const pendingWrites: CheckpointTuple["pendingWrites"] = [];
    for (const w of writes) {
      pendingWrites.push([
        String(w.task_id),
        String(w.channel),
        await this.serde.loadsTyped(String(w.type || "json"), w.value as Uint8Array),
      ]);
    }

    const parentCheckpointId = row.parent_checkpoint_id
      ? String(row.parent_checkpoint_id)
      : undefined;

    return {
      config: {
        configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: String(row.checkpoint_id),
        },
      },
      checkpoint,
      metadata,
      parentConfig: parentCheckpointId
        ? {
            configurable: {
              thread_id,
              checkpoint_ns,
              checkpoint_id: parentCheckpointId,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();
    const thread_id = config.configurable?.thread_id as string | undefined;
    if (!thread_id) return;
    const checkpoint_ns = String(config.configurable?.checkpoint_ns ?? "");
    const limit = options?.limit ?? 10;
    const rows = this.driver
      .prepare(
        `SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC LIMIT ?`
      )
      .all(thread_id, checkpoint_ns, limit);
    for (const row of rows) {
      const tuple = await this.getTuple({
        configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: String(row.checkpoint_id),
        },
      });
      if (tuple) yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, number | string>
  ): Promise<RunnableConfig> {
    this.setup();
    const thread_id = config.configurable?.thread_id as string | undefined;
    const checkpoint_ns = String(config.configurable?.checkpoint_ns ?? "");
    const parent_checkpoint_id = config.configurable?.checkpoint_id as
      | string
      | undefined;
    if (!thread_id) throw new Error('Missing "thread_id" in config.configurable');

    const prepared = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(prepared),
        this.serde.dumpsTyped(metadata),
      ]);
    if (type1 !== type2) {
      throw new Error("Failed to serialize checkpoint and metadata to same type");
    }

    this.driver
      .prepare(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        thread_id,
        checkpoint_ns,
        checkpoint.id,
        parent_checkpoint_id ?? null,
        type1,
        serializedCheckpoint,
        serializedMetadata
      );

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    _taskPath?: string
  ): Promise<void> {
    this.setup();
    const thread_id = config.configurable?.thread_id as string | undefined;
    const checkpoint_ns = String(config.configurable?.checkpoint_ns ?? "");
    const checkpoint_id = config.configurable?.checkpoint_id as string | undefined;
    if (!thread_id || !checkpoint_id) {
      throw new Error("Missing thread_id or checkpoint_id for putWrites");
    }
    let idx = 0;
    for (const [channel, value] of writes) {
      const [type, serialized] = await this.serde.dumpsTyped(value);
      this.driver
        .prepare(
          `INSERT OR REPLACE INTO checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          thread_id,
          checkpoint_ns,
          checkpoint_id,
          taskId,
          idx,
          channel,
          type,
          serialized
        );
      idx += 1;
    }
    // pending sends channel marker compatibility
    void TASKS;
  }

  async deleteThread(threadId: string): Promise<void> {
    this.setup();
    this.driver.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
    this.driver
      .prepare("DELETE FROM checkpoint_writes WHERE thread_id = ?")
      .run(threadId);
  }
}

let cached: SamSqliteSaver | null = null;

export function getCheckpointer(): SamSqliteSaver {
  const driver = getPersistence().driver;
  if (!cached) cached = SamSqliteSaver.fromDriver(driver);
  return cached;
}

export function __resetCheckpointerForTests(): void {
  cached = null;
}
