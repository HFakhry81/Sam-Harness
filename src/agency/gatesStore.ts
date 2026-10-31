/**
 * Per-run gates.json — keyed by runId, reset for each pack/run.
 * Prevents prior-run loop entries from leaking into the next pack.
 */
import * as fs from "fs";
import * as path from "path";

export type GateEntry = {
  at: string;
  loop: number;
  gate: "OPEN" | "CLOSED";
  auditPassed: boolean;
  goalPassed: boolean;
  goalFidelityScore?: number;
  reqCoverage?: number;
  missingCitations?: string[];
  rejectReasons?: string[];
  modelErrors?: ModelClaimError[];
  [key: string]: unknown;
};

export type ModelClaimError = {
  at: string;
  kind: "invalid_path" | "invalid_currency" | "placeholder" | "other";
  claim: string;
  detail: string;
  loop?: number;
};

export type GatesDocument = {
  runId: string;
  startedAt: string;
  gates: GateEntry[];
  latest: GateEntry | null;
  modelErrors: ModelClaimError[];
};

function gatesPath(cwd: string = process.cwd()): string {
  return path.join(cwd, "gates.json");
}

/** Resolve current run id from env or explicit arg. */
export function currentRunId(explicit?: string): string {
  return (
    explicit ||
    process.env.SAM_HARNESS_RUN_ID ||
    process.env.SAM_RUN_ID ||
    `run-${Date.now().toString(36)}`
  );
}

/** Reset gates.json for a new run (call at agency start / pack begin). */
export function resetGatesForRun(
  runId?: string,
  cwd: string = process.cwd()
): GatesDocument {
  const id = currentRunId(runId);
  const doc: GatesDocument = {
    runId: id,
    startedAt: new Date().toISOString(),
    gates: [],
    latest: {
      at: new Date().toISOString(),
      loop: 0,
      gate: "CLOSED",
      auditPassed: false,
      goalPassed: false,
    },
    modelErrors: [],
  };
  fs.writeFileSync(gatesPath(cwd), JSON.stringify(doc, null, 2), "utf-8");
  return doc;
}

export function readGates(cwd: string = process.cwd()): GatesDocument | null {
  const p = gatesPath(cwd);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<GatesDocument> & {
      gates?: GateEntry[];
    };
    // Legacy shape { gates: [] } without runId — treat as foreign
    if (!raw.runId) {
      return {
        runId: "(legacy)",
        startedAt: "",
        gates: Array.isArray(raw.gates) ? raw.gates : [],
        latest: (raw as GatesDocument).latest || null,
        modelErrors: Array.isArray((raw as GatesDocument).modelErrors)
          ? (raw as GatesDocument).modelErrors
          : [],
      };
    }
    return {
      runId: raw.runId,
      startedAt: raw.startedAt || "",
      gates: Array.isArray(raw.gates) ? raw.gates : [],
      latest: raw.latest ?? null,
      modelErrors: Array.isArray(raw.modelErrors) ? raw.modelErrors : [],
    };
  } catch {
    return null;
  }
}

/**
 * Append a gate entry for THIS run only.
 * If gates.json belongs to another runId, reset first.
 */
export function appendGateEntry(
  entry: GateEntry,
  runId?: string,
  cwd: string = process.cwd()
): GatesDocument {
  const id = currentRunId(runId);
  let doc = readGates(cwd);
  if (!doc || doc.runId !== id) {
    doc = resetGatesForRun(id, cwd);
  }
  doc.gates.push(entry);
  doc.latest = entry;
  fs.writeFileSync(gatesPath(cwd), JSON.stringify(doc, null, 2), "utf-8");
  return doc;
}

export function appendModelClaimError(
  err: ModelClaimError,
  runId?: string,
  cwd: string = process.cwd()
): GatesDocument {
  const id = currentRunId(runId);
  let doc = readGates(cwd);
  if (!doc || doc.runId !== id) {
    doc = resetGatesForRun(id, cwd);
  }
  doc.modelErrors.push(err);
  fs.writeFileSync(gatesPath(cwd), JSON.stringify(doc, null, 2), "utf-8");
  return doc;
}

/** Ensure gates file exists for this run (CLOSED until APPROVED). */
export function ensureGatesForRun(
  runId?: string,
  cwd: string = process.cwd()
): GatesDocument {
  const id = currentRunId(runId);
  const existing = readGates(cwd);
  if (existing && existing.runId === id) return existing;
  return resetGatesForRun(id, cwd);
}

/** Append model claim errors into evidence.json (and gates). */
export function appendModelErrorsToEvidence(
  errors: ModelClaimError[],
  cwd: string = process.cwd()
): void {
  if (!errors.length) return;
  const p = path.join(cwd, "evidence.json");
  if (!fs.existsSync(p)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as {
      modelErrors?: ModelClaimError[];
      [key: string]: unknown;
    };
    const prev = Array.isArray(raw.modelErrors) ? raw.modelErrors : [];
    raw.modelErrors = [...prev, ...errors];
    fs.writeFileSync(p, JSON.stringify(raw, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

/** Log model errors to both gates.json and evidence.json. */
export function logModelClaimErrors(
  errors: ModelClaimError[],
  runId?: string,
  cwd: string = process.cwd()
): void {
  if (!errors.length) return;
  for (const err of errors) {
    appendModelClaimError(err, runId, cwd);
  }
  appendModelErrorsToEvidence(errors, cwd);
}
