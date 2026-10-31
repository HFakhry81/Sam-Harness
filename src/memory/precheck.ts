/**
 * Apply promoted memory rules as deterministic pre-checks before the auditor.
 */
import { asciiGateReason } from "../agency/asciiText.js";
import { loadPromotedRules } from "./promote.js";
import type { PromoteRule } from "./types.js";

export type PrecheckIssue = {
  ruleId: string;
  pattern: string;
  reason: string;
};

export type PrecheckResult = {
  ok: boolean;
  issues: PrecheckIssue[];
};

function matchesRule(text: string, rule: PromoteRule): boolean {
  if (!rule.pattern) return false;
  if (rule.regex) {
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return text.toLowerCase().includes(rule.pattern.toLowerCase());
    }
  }
  return text.toLowerCase().includes(rule.pattern.toLowerCase());
}

/**
 * Run all promoted rules against strategy text.
 * Failures become ASCII reject reasons suitable for gate ingestion.
 */
export function runPromotedPrechecks(
  strategy: string,
  home?: string,
  rules?: PromoteRule[]
): PrecheckResult {
  const list = rules || loadPromotedRules(home).rules;
  const issues: PrecheckIssue[] = [];
  const text = String(strategy || "");
  for (const rule of list) {
    if (matchesRule(text, rule)) {
      issues.push({
        ruleId: rule.id,
        pattern: rule.pattern,
        reason: asciiGateReason(
          `Promoted memory pre-check FAIL: forbidden pattern "${rule.pattern}" (rule ${rule.id})`
        ),
      });
    }
  }
  return { ok: issues.length === 0, issues };
}
