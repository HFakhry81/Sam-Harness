import * as http from "http";
import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSessionsForTests,
  assertCsrfOrigin,
  authenticateRequest,
  createSession,
  isAllowedHost,
  isAllowedOrigin,
  sessionCookieHeader,
  SESSION_COOKIE,
  timingSafeEqualString,
} from "../src/controlplane/auth.js";

const OWNER = "test-owner-token-abcdefghijklmnopqrstuvwxyz";
const PORT = 8787;

function fakeReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): http.IncomingMessage {
  return {
    method: opts.method || "GET",
    url: opts.url || "/api/run",
    headers: {
      host: `127.0.0.1:${PORT}`,
      ...opts.headers,
    },
  } as http.IncomingMessage;
}

describe("Control Plane auth", () => {
  beforeEach(() => {
    __resetSessionsForTests();
  });

  it("timingSafeEqualString matches equal strings", () => {
    expect(timingSafeEqualString(OWNER, OWNER)).toBe(true);
    expect(timingSafeEqualString(OWNER, OWNER + "x")).toBe(false);
    expect(timingSafeEqualString("a", "b")).toBe(false);
  });

  it("allows only loopback Host", () => {
    expect(isAllowedHost("127.0.0.1:8787", PORT)).toBe(true);
    expect(isAllowedHost("localhost:8787", PORT)).toBe(true);
    expect(isAllowedHost("evil.example:8787", PORT)).toBe(false);
    expect(isAllowedHost("127.0.0.1:9999", PORT)).toBe(false);
  });

  it("rejects foreign Origin (CSRF)", () => {
    expect(isAllowedOrigin("https://evil.example", undefined, PORT)).toBe(false);
    expect(() =>
      assertCsrfOrigin(
        fakeReq({
          method: "POST",
          headers: { origin: "https://evil.example", host: `127.0.0.1:${PORT}` },
        }),
        PORT
      )
    ).toThrow(/foreign Origin/i);
  });

  it("/api/run without token → 401", () => {
    const auth = authenticateRequest(fakeReq({ method: "POST", url: "/api/run" }), OWNER, {
      port: PORT,
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.status).toBe(401);
    }
  });

  it("foreign Origin with bearer → 403", () => {
    const auth = authenticateRequest(
      fakeReq({
        method: "POST",
        url: "/api/run",
        headers: {
          authorization: `Bearer ${OWNER}`,
          origin: "https://attacker.test",
        },
      }),
      OWNER,
      { port: PORT, allowMissingOriginWithBearer: true }
    );
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.status).toBe(403);
    }
  });

  it("accepts Bearer owner token on loopback without Origin", () => {
    const auth = authenticateRequest(
      fakeReq({
        method: "POST",
        url: "/api/run",
        headers: { authorization: `Bearer ${OWNER}` },
      }),
      OWNER,
      { port: PORT, allowMissingOriginWithBearer: true }
    );
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.via).toBe("bearer");
  });

  it("session + CSRF header authorizes mutating routes", () => {
    const sess = createSession();
    const auth = authenticateRequest(
      fakeReq({
        method: "POST",
        url: "/api/run",
        headers: {
          cookie: sessionCookieHeader(sess.id).split(";")[0],
          "x-csrf-token": sess.csrfToken,
          origin: `http://127.0.0.1:${PORT}`,
        },
      }),
      OWNER,
      { port: PORT }
    );
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.via).toBe("session");
  });

  it("session without CSRF on POST → 403", () => {
    const sess = createSession();
    const auth = authenticateRequest(
      fakeReq({
        method: "POST",
        url: "/api/run",
        headers: {
          cookie: `${SESSION_COOKIE}=${sess.id}`,
          origin: `http://127.0.0.1:${PORT}`,
        },
      }),
      OWNER,
      { port: PORT }
    );
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(403);
  });
});
