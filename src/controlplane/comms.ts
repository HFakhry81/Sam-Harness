/**
 * P7 — Comms stubs: notification drafts + send policy gate (no real SMTP yet).
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type CommDraft = {
  id: string;
  channel: "email" | "desktop-notify";
  to?: string;
  subject: string;
  body: string;
  status: "draft" | "approved" | "sent-simulated" | "blocked";
  createdAt: string;
  note?: string;
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

export function createCommDraft(
  cwd: string,
  input: { channel?: "email" | "desktop-notify"; to?: string; subject: string; body: string }
): CommDraft {
  const store = load(cwd);
  const draft: CommDraft = {
    id: `comm-${crypto.randomBytes(3).toString("hex")}`,
    channel: input.channel || "desktop-notify",
    to: input.to,
    subject: (input.subject || "").trim() || "Sam-Harness notification",
    body: (input.body || "").trim(),
    status: "draft",
    createdAt: new Date().toISOString(),
    note: "Requires explicit approve before send (P7 policy)",
  };
  store.drafts.unshift(draft);
  save(cwd, store);
  return draft;
}

export function requestCommSend(cwd: string, id: string, approved: boolean): CommDraft | null {
  const store = load(cwd);
  const d = store.drafts.find((x) => x.id === id);
  if (!d) return null;
  if (!approved) {
    d.status = "blocked";
    d.note = "Send rejected — approved=false";
    save(cwd, store);
    return d;
  }
  const allow = String(process.env.APPROVE_COMMS || "").trim() === "1";
  if (!allow) {
    d.status = "blocked";
    d.note = "Blocked: set APPROVE_COMMS=1 to simulate send";
    save(cwd, store);
    return d;
  }
  d.status = "sent-simulated";
  d.note = "Simulated send only — no external SMTP in this build";
  save(cwd, store);
  return d;
}
