/**
 * Control Plane owner-token auth + CSRF (loopback UI/API).
 * Token: CONTROL_PLANE_TOKEN env, else generated once into .controlplane-token (AES-256 encrypted).
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";

export const TOKEN_FILE = ".controlplane-token";
export const SESSION_COOKIE = "sh_session";
export const CSRF_HEADER = "x-csrf-token";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const SESSION_ROTATE_AFTER_MS = 4 * 60 * 60 * 1000; // تدوير الجلسة كل 4 ساعات
const MAX_SESSIONS = 100; // أقصى عدد جلسات نشطة
const ENCRYPTION_ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

export type AuthSession = {
  id: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  mfaVerified?: boolean; // هل تم التحقق من MFA لهذه الجلسة
};

const sessions = new Map<string, AuthSession>();

/** ---------- المصادقة متعددة العوامل MFA (TOTP RFC 6238) ---------- */
const MFA_SECRET_ENV = "CONTROL_PLANE_MFA_SECRET";
const MFA_CODE_TTL_MS = 5 * 60 * 1000; // رمز MFA صالح لمدة 5 دقائق
const mfaPending = new Map<string, { secret: string; expiresAt: number }>(); // sessionId -> secret

/** توليد مفتاح سري لـ TOTP إذا لم يكن محددًا في متغيرات البيئة. */
function getMfaSecret(): string {
  const env = process.env[MFA_SECRET_ENV];
  if (env) return env;
  // إنشاء مفتاح افتراضي من رمز التحكم (ليست مثالية للإنتاج ولكنها تعمل للتطوير)
  const token = loadOrCreateOwnerToken(".");
  return crypto.createHash("sha256").update(token + "mfa-salt").digest("hex").slice(0, 32);
}

/** إنشاء رمز TOTP للمصادقة الثنائية (بناءً على الوقت الحالي). */
export function generateTOTP(secret: string, timeStepMs: number = 30_000): string {
  let timeCounter = Math.floor(Date.now() / timeStepMs);
  const counterBuffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = timeCounter & 0xff;
    timeCounter = timeCounter >>> 8;
  }
  const key = Buffer.from(secret, "utf8");
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = (binary % 1_000_000).toString().padStart(6, "0");
  return otp;
}

/** التحقق من رمز TOTP الذي أدخله المستخدم (يسمح بفارق خطوة واحدة للأمام والوراء). */
function verifyTOTP(secret: string, code: string): boolean {
  const now = Date.now();
  for (let step = -1; step <= 1; step++) {
    const adjustedTime = Math.floor((now + step * 30_000) / 30_000);
    const expected = generateTOTP(secret, 30_000);
    // generateTOTP يستخدم الوقت الحالي، لذا نعدله يدويًا لكل خطوة
    const counterBuffer = Buffer.alloc(8);
    let counter = adjustedTime;
    for (let i = 7; i >= 0; i--) {
      counterBuffer[i] = counter & 0xff;
      counter = counter >>> 8;
    }
    const key = Buffer.from(secret, "utf8");
    const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const otp = (binary % 1_000_000).toString().padStart(6, "0");
    if (timingSafeEqualString(otp, code)) return true;
  }
  return false;
}

/** بدء جلسة MFA معلقة لمستخدم ما (يتم استدعاؤها قبل تنفيذ عملية حساسة). */
export function initiateMfa(sessionId: string): { secret: string; expiresAt: number } {
  const secret = getMfaSecret();
  const entry = { secret, expiresAt: Date.now() + MFA_CODE_TTL_MS };
  mfaPending.set(sessionId, entry);
  return entry;
}

/** التحقق من رمز MFA وإكمال المصادقة الثنائية للجلسة. */
export function completeMfa(sessionId: string, code: string): boolean {
  const entry = mfaPending.get(sessionId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    mfaPending.delete(sessionId);
    return false;
  }
  if (!verifyTOTP(entry.secret, code)) return false;
  // تعيين الجلسة كموثقة عبر MFA
  const session = sessions.get(sessionId);
  if (session) {
    session.mfaVerified = true;
    sessions.set(sessionId, session);
  }
  mfaPending.delete(sessionId);
  return true;
}

/** التحقق من أن الجلسة موثقة عبر MFA (مطلوب للعمليات الحساسة). */
export function isMfaVerified(sessionId: string | undefined | null): boolean {
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  return Boolean(session?.mfaVerified);
}

/** operations التي تتطلب MFA */
export const MFA_REQUIRED_OPS = new Set([
  "implement",      // تنفيذ الكود (Level-3)
  "send_email",     // إرسال الإيميل
  "delete_data",    // حذف البيانات
  "change_config",  // تغيير الإعدادات
]);

/** هل تتطلب هذه العملية مصادقة MFA؟ */
export function requiresMfa(operation: string): boolean {
  return MFA_REQUIRED_OPS.has(operation);
}

function getEncryptionKey(): Buffer {
  const keyEnv = process.env.CONTROL_PLANE_ENCRYPTION_KEY;
  if (keyEnv) {
    return crypto.scryptSync(keyEnv, "sam-harness-token-v1", 32);
  }
  // Fallback: derive from a stable salt (not ideal but better than plain text)
  console.warn(
    "[auth] CONTROL_PLANE_ENCRYPTION_KEY not set — token encryption uses a derived fallback key. " +
      "Set CONTROL_PLANE_ENCRYPTION_KEY for production."
  );
  return crypto.scryptSync("sam-harness-fallback-token-key", "sam-harness-token-v1", 32);
}

function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 2) {
    // Backward compatibility: treat as plain text
    return encrypted;
  }
  const iv = Buffer.from(parts[0], "hex");
  const encryptedData = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted.toString("utf8");
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) {
    // Constant-time sink so length mismatch is not a fast-path oracle
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  if (ba.length === 0) return true;
  return crypto.timingSafeEqual(ba, bb);
}

export function loadOrCreateOwnerToken(root: string): string {
  const fromEnv = String(process.env.CONTROL_PLANE_TOKEN || "").trim();
  if (fromEnv) return fromEnv;

  const file = path.join(root, TOKEN_FILE);
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return decryptToken(existing);
    }
  } catch {
    /* regenerate below */
  }

  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(file, encryptToken(token) + "\n", { encoding: "utf8", mode: 0o600 });
  return token;
}

export function createSession(): AuthSession {
  pruneSessions();
  // فرض حد أقصى على عدد الجلسات النشطة
  if (sessions.size >= MAX_SESSIONS) {
    const oldestKey = sessions.keys().next().value;
    if (oldestKey !== undefined) sessions.delete(oldestKey);
  }
  const session: AuthSession = {
    id: crypto.randomBytes(24).toString("base64url"),
    csrfToken: crypto.randomBytes(24).toString("base64url"),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string | undefined | null): AuthSession | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    return null;
  }
  // تدوير الجلسة إذا مرت أكثر من 4 ساعات منذ إنشائها
  if (Date.now() > s.createdAt + SESSION_ROTATE_AFTER_MS) {
    sessions.delete(id);
    const rotated = createSession();
    // نسخ CSRF توكن من الجلسة القديمة للحفاظ على الاستمرارية
    rotated.csrfToken = s.csrfToken;
    sessions.set(rotated.id, rotated);
    return rotated;
  }
  return s;
}

export function destroySession(id: string | undefined | null): void {
  if (id) sessions.delete(id);
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(id);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieHeader(sessionId: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeSec)}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function extractBearer(req: http.IncomingMessage): string | null {
  const h = String(req.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function extractOwnerTokenFromRequest(req: http.IncomingMessage): string | null {
  const bearer = extractBearer(req);
  if (bearer) return bearer;
  // Query-string tokens are accepted ONLY for the SSE stream: EventSource cannot
  // set headers. Never accept them for mutating calls or other routes, so the
  // token cannot leak through logs/history/referrers.
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET") return null;
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/events") return null;
  const q = url.searchParams.get("token");
  return q && q.trim() ? q.trim() : null;
}

/** Host must be loopback (DNS-rebinding defense). */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  const allowed = new Set([
    "127.0.0.1",
    "localhost",
    `[::1]`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  return allowed.has(host);
}

/** Origin/Referer must be loopback Control Plane (CSRF / cross-site). */
export function isAllowedOrigin(
  origin: string | undefined,
  referer: string | undefined,
  port: number
): boolean {
  const candidates = [origin, referer].filter(Boolean) as string[];
  if (!candidates.length) return false;
  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      const hostOk =
        u.hostname === "127.0.0.1" ||
        u.hostname === "localhost" ||
        u.hostname === "::1";
      if (!hostOk) continue;
      if (u.port && Number(u.port) !== port) continue;
      if (!u.port && port !== 80 && port !== 443) {
        // URL without explicit port is only OK for default HTTP(S) ports
        continue;
      }
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * For mutating methods: require loopback Origin or Referer.
 * Same-origin browsers always send Origin on POST; reject foreign Origin.
 */
export function assertCsrfOrigin(req: http.IncomingMessage, port: number): void {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;

  // Explicit foreign Origin → always reject
  if (origin) {
    try {
      const u = new URL(origin);
      const hostOk =
        u.hostname === "127.0.0.1" ||
        u.hostname === "localhost" ||
        u.hostname === "::1";
      if (!hostOk) {
        throw Object.assign(new Error("Forbidden: foreign Origin"), { statusCode: 403 });
      }
      if (u.port && Number(u.port) !== port) {
        throw Object.assign(new Error("Forbidden: Origin port mismatch"), { statusCode: 403 });
      }
      return;
    } catch (e: any) {
      if (e?.statusCode === 403) throw e;
      throw Object.assign(new Error("Forbidden: invalid Origin"), { statusCode: 403 });
    }
  }

  // No Origin — require Referer from loopback (or Bearer owner token path handled by caller)
  if (referer && isAllowedOrigin(undefined, referer, port)) return;

  // Non-browser API clients using Bearer may omit Origin/Referer — caller decides
  throw Object.assign(new Error("Forbidden: missing or invalid Origin/Referer (CSRF)"), {
    statusCode: 403,
  });
}

export type AuthResult =
  | { ok: true; via: "session" | "bearer"; session?: AuthSession }
  | { ok: false; status: number; error: string };

/**
 * Authenticate a request against the owner token.
 * - Session cookie after login, or
 * - Authorization: Bearer <ownerToken>, or
 * - ?token= for EventSource
 */
export function authenticateRequest(
  req: http.IncomingMessage,
  ownerToken: string,
  opts?: { requireCsrf?: boolean; port?: number; allowMissingOriginWithBearer?: boolean }
): AuthResult {
  const port = opts?.port ?? 8787;
  const host = req.headers.host as string | undefined;
  if (!isAllowedHost(host, port)) {
    return { ok: false, status: 403, error: "Forbidden: invalid Host" };
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = getSession(cookies[SESSION_COOKIE]);
  const bearerOrQuery = extractOwnerTokenFromRequest(req);
  const method = (req.method || "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (session) {
    if (mutating && opts?.requireCsrf !== false) {
      const csrf = String(req.headers[CSRF_HEADER] || "").trim();
      if (!timingSafeEqualString(csrf, session.csrfToken)) {
        return { ok: false, status: 403, error: "Forbidden: CSRF token mismatch" };
      }
      try {
        assertCsrfOrigin(req, port);
      } catch (e: any) {
        return { ok: false, status: e?.statusCode || 403, error: e?.message || "CSRF failed" };
      }
    }
    return { ok: true, via: "session", session };
  }

  if (bearerOrQuery && timingSafeEqualString(bearerOrQuery, ownerToken)) {
    if (mutating) {
      const origin = req.headers.origin as string | undefined;
      if (origin) {
        try {
          assertCsrfOrigin(req, port);
        } catch (e: any) {
          return { ok: false, status: e?.statusCode || 403, error: e?.message || "CSRF failed" };
        }
      } else if (!opts?.allowMissingOriginWithBearer) {
        // EventSource / curl with Bearer: allow missing Origin only for non-browser tooling
        // Still reject if Referer is foreign
        const referer = req.headers.referer as string | undefined;
        if (referer && !isAllowedOrigin(undefined, referer, port)) {
          return { ok: false, status: 403, error: "Forbidden: foreign Referer" };
        }
      }
    }
    return { ok: true, via: "bearer" };
  }

  return { ok: false, status: 401, error: "Unauthorized: login required" };
}

/** Test helper — clear in-memory sessions between tests. */
export function __resetSessionsForTests(): void {
  sessions.clear();
}
