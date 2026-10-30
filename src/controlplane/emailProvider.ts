/**
 * Outbound email adapters: SMTP (nodemailer) and Resend API.
 * When not configured → dry-run (no network). Never auto-send without caller approval.
 */
import nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";
import { ensureOutputHome } from "../lib/outputHome.js";

export type EmailProviderKind = "smtp" | "resend" | "dry-run";

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string;
  from?: string;
  html?: boolean;
};

export type SendEmailResult = {
  ok: boolean;
  provider: EmailProviderKind;
  dryRun: boolean;
  messageId?: string;
  error?: string;
  loggedAt: string;
};

export type EmailProviderStatus = {
  provider: EmailProviderKind;
  configured: boolean;
  dryRun: boolean;
  from?: string;
  hint: string;
};

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

export function detectEmailProvider(): EmailProviderStatus {
  // Owner decision (Phase 3): default EMAIL_PROVIDER=smtp.
  // Still dry-run when SMTP_* is unset. Explicit dry-run|resend overrides.
  const forcedRaw = env("EMAIL_PROVIDER").toLowerCase();
  const forced = forcedRaw || "smtp";
  const from =
    env("EMAIL_FROM") ||
    env("SMTP_FROM") ||
    env("RESEND_FROM") ||
    undefined;

  if (forced === "dry-run" || forced === "dryrun" || forced === "none") {
    return {
      provider: "dry-run",
      configured: false,
      dryRun: true,
      from,
      hint: "EMAIL_PROVIDER=dry-run — outbound simulated only",
    };
  }

  const hasSmtp = Boolean(env("SMTP_HOST"));
  const hasResend = Boolean(env("RESEND_API_KEY"));

  if (forced === "resend") {
    return {
      provider: "resend",
      configured: hasResend,
      dryRun: !hasResend,
      from: from || "onboarding@resend.dev",
      hint: hasResend
        ? "Resend API"
        : "Set RESEND_API_KEY and EMAIL_FROM (or RESEND_FROM)",
    };
  }

  // Default / explicit smtp
  if (forced === "smtp" || hasSmtp) {
    return {
      provider: "smtp",
      configured: hasSmtp,
      dryRun: !hasSmtp,
      from,
      hint: hasSmtp
        ? `SMTP via ${env("SMTP_HOST")}`
        : "EMAIL_PROVIDER=smtp (default) — set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM (dry-run until configured)",
    };
  }

  // Fallback if someone forces an unknown provider without SMTP
  if (hasResend) {
    return {
      provider: "resend",
      configured: true,
      dryRun: false,
      from: from || "onboarding@resend.dev",
      hint: "Resend API",
    };
  }

  return {
    provider: "smtp",
    configured: false,
    dryRun: true,
    from,
    hint: "EMAIL_PROVIDER=smtp (default) — SMTP_* unset, dry-run mode",
  };
}

function appendSendLog(
  entry: Record<string, unknown>,
  cwd: string = process.cwd()
): string {
  const layout = ensureOutputHome();
  const logDir = path.join(layout.runs, "comms");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "email-send.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  // Also mirror under cwd for local debugging (gitignored via *.jsonl pattern? keep under output home only)
  void cwd;
  return logPath;
}

async function sendViaSmtp(input: SendEmailInput): Promise<SendEmailResult> {
  const host = env("SMTP_HOST");
  const port = Number(env("SMTP_PORT") || 587);
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const from = input.from || env("EMAIL_FROM") || env("SMTP_FROM") || user;
  const secure =
    env("SMTP_SECURE") === "1" ||
    env("SMTP_SECURE") === "true" ||
    port === 465;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  const info = await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.html ? undefined : input.body,
    html: input.html ? input.body : undefined,
  });

  return {
    ok: true,
    provider: "smtp",
    dryRun: false,
    messageId: info.messageId,
    loggedAt: new Date().toISOString(),
  };
}

async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const key = env("RESEND_API_KEY");
  const from =
    input.from ||
    env("EMAIL_FROM") ||
    env("RESEND_FROM") ||
    "onboarding@resend.dev";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.html ? undefined : input.body,
      html: input.html ? input.body : undefined,
    }),
  });

  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    return {
      ok: false,
      provider: "resend",
      dryRun: false,
      error: parsed?.message || text.slice(0, 300) || `HTTP ${res.status}`,
      loggedAt: new Date().toISOString(),
    };
  }
  return {
    ok: true,
    provider: "resend",
    dryRun: false,
    messageId: parsed?.id,
    loggedAt: new Date().toISOString(),
  };
}

/**
 * Send email via configured provider, or dry-run when not configured.
 * Caller MUST enforce approval / APPROVE_COMMS before invoking.
 */
export async function sendEmail(
  input: SendEmailInput,
  opts?: { cwd?: string; forceDryRun?: boolean }
): Promise<SendEmailResult> {
  const status = detectEmailProvider();
  const to = String(input.to || "").trim();
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "");
  const loggedAt = new Date().toISOString();

  if (!to || !subject) {
    const fail: SendEmailResult = {
      ok: false,
      provider: status.provider,
      dryRun: true,
      error: "to and subject required",
      loggedAt,
    };
    appendSendLog({ ...fail, to, subject }, opts?.cwd);
    return fail;
  }

  const dry =
    opts?.forceDryRun === true ||
    status.dryRun ||
    !status.configured ||
    status.provider === "dry-run";

  if (dry) {
    const result: SendEmailResult = {
      ok: true,
      provider: "dry-run",
      dryRun: true,
      messageId: `dry-${Date.now().toString(36)}`,
      loggedAt,
    };
    appendSendLog(
      {
        ...result,
        to,
        subject,
        bodyPreview: body.slice(0, 200),
        note: status.hint,
      },
      opts?.cwd
    );
    return result;
  }

  try {
    const result =
      status.provider === "resend"
        ? await sendViaResend({ ...input, to, subject, body })
        : await sendViaSmtp({ ...input, to, subject, body });
    appendSendLog(
      {
        ...result,
        to,
        subject,
        bodyPreview: body.slice(0, 200),
      },
      opts?.cwd
    );
    return result;
  } catch (e: any) {
    const fail: SendEmailResult = {
      ok: false,
      provider: status.provider,
      dryRun: false,
      error: e?.message || String(e),
      loggedAt: new Date().toISOString(),
    };
    appendSendLog({ ...fail, to, subject }, opts?.cwd);
    return fail;
  }
}
