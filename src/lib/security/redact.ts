/**
 * Cloud-egress redaction (Phase 1).
 *
 * The harness reads real user projects. Before any prompt leaves the machine for
 * a cloud/free provider we strip credential-shaped strings so a `.env` value or
 * a pasted key can never be forwarded — even if the agent read it by accident.
 *
 * This is defense in depth: `paths.ts` already denies secret file names, but
 * secrets also arrive through logs, README snippets, and user pastes.
 */

export type RedactionResult = {
  text: string;
  hits: number;
  kinds: string[];
};

type Rule = { kind: string; re: RegExp };

const RULES: Rule[] = [
  {
    kind: "private_key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // OpenAI / Anthropic style keys
  { kind: "openai_key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g },
  { kind: "google_key", re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { kind: "aws_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    kind: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { kind: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi },
  // KEY=value / "TOKEN": "value" lines copied out of a .env file
  {
    kind: "env_assignment",
    re: /^(\s*[A-Za-z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Za-z0-9_]*\s*[=:]\s*)(["']?)([^\s"'\r\n]{8,})\2/gim,
  },
];

/**
 * Redact secrets. `env_assignment` keeps the variable name (useful context) but
 * replaces the value, so the model can still reason about configuration.
 */
export function redactSensitive(input: string): RedactionResult {
  let text = String(input ?? "");
  const kinds = new Set<string>();
  let hits = 0;

  for (const rule of RULES) {
    if (rule.kind === "env_assignment") {
      text = text.replace(rule.re, (_m, prefix: string, quote: string) => {
        hits += 1;
        kinds.add(rule.kind);
        return `${prefix}${quote}[REDACTED:${rule.kind}]${quote}`;
      });
      continue;
    }
    text = text.replace(rule.re, () => {
      hits += 1;
      kinds.add(rule.kind);
      return `[REDACTED:${rule.kind}]`;
    });
  }

  return { text, hits, kinds: [...kinds] };
}

export function hasSensitiveData(input: string): boolean {
  return redactSensitive(input).hits > 0;
}
