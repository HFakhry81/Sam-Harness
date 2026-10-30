/**
 * P7 — Comms: notification drafts + approval-gated outbound email.
 * Providers: SMTP (nodemailer), Resend API, or dry-run when not configured.
 * Never auto-sends without owner approval (approved=true + APPROVE_COMMS=1).
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  detectEmailProvider,
  sendEmail,
  type EmailProviderStatus,
  type SendEmailResult,
} from "./emailProvider.js";

export type CommDraft = {
  id: string;
  channel: "email" | "desktop-notify";
  to?: string;
  subject: string;
  body: string;
  status:
    | "draft"
    | "approved"
    | "sent"
    | "sent-dry-run"
    | "sent-simulated"
    | "blocked";
  createdAt: string;
  note?: string;
  provider?: string;
  messageId?: string;
  sendResult?: SendEmailResult;
};

export type CommsStore = { drafts: CommDraft[] };

const FILE = "comms-drafts.json";

function load(cwd: string): CommsStore {
  const p = path.join(cwd, FILE);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    /* ignore */
  }
  return { drafts: [] };
}

function save(cwd: string, store: CommsStore): void {
  fs.writeFileSync(path.join(cwd, FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function loadComms(cwd: string): CommsStore {
  return load(cwd);
}

export function getCommsProviderStatus(): EmailProviderStatus {
  return detectEmailProvider();
}

export function createCommDraft(
  cwd: string,
  input: {
    channel?: "email" | "desktop-notify";
    to?: string;
    subject: string;
    body: string;
  }
): CommDraft {
  const store = load(cwd);
  const channel = input.channel || (input.to ? "email" : "desktop-notify");
  const draft: CommDraft = {
    id: `comm-${crypto.randomBytes(3).toString("hex")}`,
    channel,
    to: input.to,
    subject: (input.subject || "").trim() || "Sam-Harness notification",
    body: (input.body || "").trim(),
    status: "draft",
    createdAt: new Date().toISOString(),
    note: "Requires explicit approve before send (approval matrix)",
  };
  store.drafts.unshift(draft);
  save(cwd, store);
  return draft;
}

/**
 * Send a draft. Requires approved=true AND APPROVE_COMMS=1.
 * Uses real SMTP/Resend when configured; otherwise dry-run (logged).
 */
export async function requestCommSend(
  cwd: string,
  id: string,
  approved: boolean
): Promise<CommDraft | null> {
  const store = load(cwd);
  const d = store.drafts.find((x) => x.id === id);
  if (!d) return null;
  if (!approved) {
    d.status = "blocked";
    d.note = "Send rejected — approved=false (owner approval required)";
    save(cwd, store);
    return d;
  }
  const allow = String(process.env.APPROVE_COMMS || "").trim() === "1";
  if (!allow) {
    d.status = "blocked";
    d.note =
      "Blocked: set APPROVE_COMMS=1 and approve in UI — no auto-send without owner approval";
    save(cwd, store);
    return d;
  }

  if (d.channel === "desktop-notify") {
    d.status = "sent-dry-run";
    d.note = "Desktop notify recorded (no OS toast in this build)";
    d.provider = "desktop-notify";
    save(cwd, store);
    return d;
  }

  const to = String(d.to || "").trim();
  if (!to) {
    d.status = "blocked";
    d.note = "Blocked: email draft missing 'to' address";
    save(cwd, store);
    return d;
  }

  const result = await sendEmail(
    { to, subject: d.subject, body: d.body },
    { cwd }
  );
  d.sendResult = result;
  d.provider = result.provider;
  d.messageId = result.messageId;
  if (!result.ok) {
    d.status = "blocked";
    d.note = `Send failed: ${result.error || "unknown"}`;
  } else if (result.dryRun) {
    d.status = "sent-dry-run";
    d.note = `Dry-run logged (${detectEmailProvider().hint})`;
  } else {
    d.status = "sent";
    d.note = `Sent via ${result.provider}` + (result.messageId ? ` id=${result.messageId}` : "");
  }
  save(cwd, store);
  return d;
}
