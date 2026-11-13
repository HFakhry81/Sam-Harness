import { db } from '../lib/db/index';

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

const SESSIONS_TABLE = 'user_sessions';

export async function initSessionStore(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      rotated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_token 
    ON ${SESSIONS_TABLE}(session_token)
  `);
  
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user 
    ON ${SESSIONS_TABLE}(user_id)
  `);
  
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expires 
    ON ${SESSIONS_TABLE}(expires_at)
  `);
}

export async function createSession(data: SessionData): Promise<void> {
  await db.run(`
    INSERT INTO ${SESSIONS_TABLE} 
    (session_token, user_id, csrf_token, user_agent, ip_address, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
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
  const row = await db.get(`
    SELECT session_token, user_id, csrf_token, user_agent, ip_address, 
           created_at, expires_at, rotated_at
    FROM ${SESSIONS_TABLE}
    WHERE session_token = ? AND expires_at > ?
  `, sessionToken, Date.now());
  
  if (!row) return null;
  
  return {
    sessionToken: row.session_token,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    rotatedAt: row.rotated_at,
  };
}

export async function updateSessionRotation(sessionToken: string, rotatedAt: number): Promise<void> {
  await db.run(`
    UPDATE ${SESSIONS_TABLE}
    SET rotated_at = ?
    WHERE session_token = ?
  `, rotatedAt, sessionToken);
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await db.run(`
    DELETE FROM ${SESSIONS_TABLE}
    WHERE session_token = ?
  `, sessionToken);
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await db.run(`
    DELETE FROM ${SESSIONS_TABLE}
    WHERE user_id = ?
  `, userId);
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.run(`
    DELETE FROM ${SESSIONS_TABLE}
    WHERE expires_at <= ?
  `, Date.now());
  
  return result.changes ?? 0;
}

export async function getUserSessions(userId: string): Promise<SessionData[]> {
  const rows = await db.all(`
    SELECT session_token, user_id, csrf_token, user_agent, ip_address, 
           created_at, expires_at, rotated_at
    FROM ${SESSIONS_TABLE}
    WHERE user_id = ? AND expires_at > ?
    ORDER BY created_at DESC
  `, userId, Date.now());
  
  return rows.map(row => ({
    sessionToken: row.session_token,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    rotatedAt: row.rotated_at,
  }));
}
