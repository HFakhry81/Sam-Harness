import { getDriver } from "../lib/db/index.js";
import type { SqlRow } from "../lib/db/types.js";

export interface SessionData {
  sessionToken: string;
  userId: string;
  csrfToken: string;
  userAgent: string;
  ipAddress: string;
  createdAt: number;
  expiresAt: number;
  rotatedAt?: number;
}

const SESSIONS_TABLE = "user_sessions";

function mapSessionRow(row: SqlRow): SessionData {
  const sessionToken = row.session_token;
  const userId = row.user_id;
  const csrfToken = row.csrf_token;
  const userAgent = row.user_agent;
  const ipAddress = row.ip_address;
  const createdAt = row.created_at;
  const expiresAt = row.expires_at;
  const rotatedAt = row.rotated_at;

  if (
    typeof sessionToken !== "string" ||
    typeof userId !== "string" ||
    typeof csrfToken !== "string" ||
    typeof userAgent !== "string" ||
    typeof ipAddress !== "string" ||
    typeof createdAt !== "number" ||
    typeof expiresAt !== "number" ||
    (rotatedAt !== null && rotatedAt !== undefined && typeof rotatedAt !== "number")
  ) {
    throw new Error("Invalid control-plane session row");
  }

  return {
    sessionToken,
    userId,
    csrfToken,
    userAgent,
    ipAddress,
    createdAt,
    expiresAt,
    rotatedAt: typeof rotatedAt === "number" ? rotatedAt : undefined,
  };
}

export async function createSession(data: SessionData): Promise<void> {
  getDriver()
    .prepare(`
      INSERT INTO ${SESSIONS_TABLE}
        (session_token, user_id, csrf_token, user_agent, ip_address, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      data.sessionToken,
      data.userId,
      data.csrfToken,
      data.userAgent,
      data.ipAddress,
      data.createdAt,
      data.expiresAt
    );
}

export async function getSessionByToken(sessionToken: string): Promise<SessionData | null> {
  const row = getDriver()
    .prepare(`
      SELECT session_token, user_id, csrf_token, user_agent, ip_address,
             created_at, expires_at, rotated_at
      FROM ${SESSIONS_TABLE}
      WHERE session_token = ? AND expires_at > ?
    `)
    .get(sessionToken, Date.now());
  if (!row) return null;
  return mapSessionRow(row);
}

export async function updateSessionRotation(sessionToken: string, rotatedAt: number): Promise<void> {
  getDriver()
    .prepare(`UPDATE ${SESSIONS_TABLE} SET rotated_at = ? WHERE session_token = ?`)
    .run(rotatedAt, sessionToken);
}

export async function deleteSession(sessionToken: string): Promise<void> {
  getDriver().prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE session_token = ?`).run(sessionToken);
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  getDriver().prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE user_id = ?`).run(userId);
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = getDriver()
    .prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE expires_at <= ?`)
    .run(Date.now());
  return result.changes;
}

export async function getUserSessions(userId: string): Promise<SessionData[]> {
  const rows = getDriver()
    .prepare(`
      SELECT session_token, user_id, csrf_token, user_agent, ip_address,
             created_at, expires_at, rotated_at
      FROM ${SESSIONS_TABLE}
      WHERE user_id = ? AND expires_at > ?
      ORDER BY created_at DESC
    `)
    .all(userId, Date.now());
  return rows.map(mapSessionRow);
}
