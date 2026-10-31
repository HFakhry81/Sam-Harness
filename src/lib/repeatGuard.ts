/**
 * After 2 failures with the same error signature, stop retrying that approach.
 * Switch tool/strategy once; if that also fails, emit a structured failure report.
 */
export type FailureSignature = {
  tool: string;
  /** Normalized message key (paths stripped / truncated). */
  key: string;
  count: number;
  lastMessage: string;
};

export type StructuredFailure = {
  success: false;
  failedStage: string;
  cause: string;
  neededToContinue: string;
  signature: string;
  attempts: number;
  summary: string;
};

function normalizeKey(tool: string, message: string): string {
  const msg = String(message || "")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<PATH>")
    .replace(/\/(?:[\w.@+-]+\/)+[\w.@+-]+/g, "<PATH>")
    .replace(/\d+/g, "N")
    .slice(0, 160)
    .toLowerCase();
  return `${tool}::${msg}`;
}

export class RepeatGuard {
  private map = new Map<string, FailureSignature>();
  private switched = new Set<string>();

  recordFailure(tool: string, message: string): FailureSignature {
    const key = normalizeKey(tool, message);
    const prev = this.map.get(key);
    const next: FailureSignature = {
      tool,
      key,
      count: (prev?.count || 0) + 1,
      lastMessage: String(message || "").slice(0, 400),
    };
    this.map.set(key, next);
    return next;
  }

  recordSuccess(tool: string, message = "ok"): void {
    const key = normalizeKey(tool, message);
    this.map.delete(key);
  }

  /** True when the same signature failed >= 2 times. */
  shouldStopRetry(sig: FailureSignature): boolean {
    return sig.count >= 2;
  }

  /** Mark that we already switched strategy for this signature. */
  markSwitched(sig: FailureSignature): void {
    this.switched.add(sig.key);
  }

  hasSwitched(sig: FailureSignature): boolean {
    return this.switched.has(sig.key);
  }

  buildStructuredFailure(input: {
    stage: string;
    sig: FailureSignature;
    neededToContinue?: string;
  }): StructuredFailure {
    const cause = input.sig.lastMessage || input.sig.key;
    const needed =
      input.neededToContinue ||
      "Use structured tools (list_dir, read_file, search_code, write_report) with quoted paths; write only under Documents/Sam-Harness; do not write into source/spec folders.";
    const summary = [
      `Structured failure at stage=${input.stage}`,
      `cause=${cause}`,
      `attempts=${input.sig.count}`,
      `needed=${needed}`,
    ].join(" | ");
    return {
      success: false,
      failedStage: input.stage,
      cause,
      neededToContinue: needed,
      signature: input.sig.key,
      attempts: input.sig.count,
      summary,
    };
  }
}

export function formatStructuredFailureMarkdown(f: StructuredFailure): string {
  return [
    `# Structured failure report`,
    ``,
    `- Failed stage: ${f.failedStage}`,
    `- Cause: ${f.cause}`,
    `- Attempts: ${f.attempts}`,
    `- Signature: ${f.signature}`,
    `- Needed to continue: ${f.neededToContinue}`,
    ``,
    f.summary,
    ``,
  ].join("\n");
}
