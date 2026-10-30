import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createCommDraft,
  getCommsProviderStatus,
  loadComms,
  requestCommSend,
} from "../src/controlplane/comms.js";
import { detectEmailProvider, sendEmail } from "../src/controlplane/emailProvider.js";

describe("comms email provider", () => {
  let dir: string;
  let home: string;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-comms-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "sam-comms-home-"));
    for (const k of [
      "APPROVE_COMMS",
      "EMAIL_PROVIDER",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASS",
      "RESEND_API_KEY",
      "EMAIL_FROM",
      "SAM_OUTPUT_HOME",
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.SAM_OUTPUT_HOME = home;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("defaults to dry-run when no provider configured", () => {
    const status = detectEmailProvider();
    expect(status.provider).toBe("dry-run");
    expect(status.dryRun).toBe(true);
  });

  it("blocks send without approval / APPROVE_COMMS", async () => {
    const draft = createCommDraft(dir, {
      channel: "email",
      to: "a@example.com",
      subject: "Hi",
      body: "Hello",
    });
    const blocked = await requestCommSend(dir, draft.id, false);
    expect(blocked?.status).toBe("blocked");

    const blocked2 = await requestCommSend(dir, draft.id, true);
    expect(blocked2?.status).toBe("blocked");
    expect(blocked2?.note).toMatch(/APPROVE_COMMS/);
  });

  it("dry-runs after APPROVE_COMMS=1 when provider unset", async () => {
    process.env.APPROVE_COMMS = "1";
    const draft = createCommDraft(dir, {
      channel: "email",
      to: "owner@example.com",
      subject: "Daily",
      body: "Report ready",
    });
    const sent = await requestCommSend(dir, draft.id, true);
    expect(sent?.status).toBe("sent-dry-run");
    expect(sent?.provider).toBe("dry-run");
    const log = path.join(home, "runs", "comms", "email-send.jsonl");
    expect(fs.existsSync(log)).toBe(true);
    expect(fs.readFileSync(log, "utf-8")).toMatch(/owner@example.com/);
  });

  it("selects smtp/resend when env present", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.EMAIL_PROVIDER = "smtp";
    expect(getCommsProviderStatus().provider).toBe("smtp");

    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    expect(detectEmailProvider().provider).toBe("resend");

    const dry = await sendEmail(
      { to: "x@y.z", subject: "t", body: "b" },
      { forceDryRun: true, cwd: dir }
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.ok).toBe(true);
  });

  it("persists drafts store", () => {
    createCommDraft(dir, { subject: "A", body: "B", to: "c@d.e" });
    expect(loadComms(dir).drafts.length).toBe(1);
  });
});
