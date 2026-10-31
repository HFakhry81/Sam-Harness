/**
 * Single-sourced agency verdict — console, final-report, and gates.json
 * all read from one object so APPROVED/CLOSED never disagree.
 */
export type AgencyVerdict = {
  auditPassed: boolean;
  goalPassed: boolean;
  gate: "OPEN" | "CLOSED";
  goalFidelityScore: number;
  loop: number;
  maxLoops: number;
  packClaimsOk: boolean;
  rejectReasons: string[];
  reason: string;
};

export function buildAgencyVerdict(input: {
  auditPassed: boolean;
  goalPassed: boolean;
  goalFidelityScore: number;
  loop: number;
  maxLoops: number;
  packClaimsOk?: boolean;
  rejectReasons?: string[];
}): AgencyVerdict {
  const packClaimsOk = input.packClaimsOk !== false;
  const auditPassed = Boolean(input.auditPassed) && packClaimsOk;
  const goalPassed = Boolean(input.goalPassed) && packClaimsOk;
  const gate = auditPassed ? "OPEN" : "CLOSED";
  const rejectReasons = [...(input.rejectReasons || [])];
  if (!packClaimsOk && !rejectReasons.some((r) => /pack claim/i.test(r))) {
    rejectReasons.push("Pack claim assertion FAIL");
  }
  let reason: string;
  if (auditPassed) {
    reason = `APPROVED — gate OPEN (rubric score=${input.goalFidelityScore.toFixed(2)}, loop ${input.loop}/${input.maxLoops})`;
  } else if (!packClaimsOk) {
    reason = `REJECTED — pack claim residues forced gate CLOSED (loop ${input.loop}/${input.maxLoops}, score=${input.goalFidelityScore.toFixed(2)})`;
  } else if (!input.auditPassed) {
    reason = `REJECTED — auditor did not approve after ${input.loop}/${input.maxLoops} loops (score=${input.goalFidelityScore.toFixed(2)})`;
  } else {
    reason = `REJECTED — goal fidelity failed (score=${input.goalFidelityScore.toFixed(2)})`;
  }
  return {
    auditPassed,
    goalPassed,
    gate,
    goalFidelityScore: input.goalFidelityScore,
    loop: input.loop,
    maxLoops: input.maxLoops,
    packClaimsOk,
    rejectReasons,
    reason,
  };
}

export function verdictMarkdown(v: AgencyVerdict): string {
  return [
    `# Agency verdict`,
    ``,
    `- result: ${v.auditPassed ? "[APPROVED]" : "[REJECTED]"}`,
    `- gate: ${v.gate}`,
    `- auditPassed: ${v.auditPassed}`,
    `- goalPassed: ${v.goalPassed}`,
    `- goalFidelityScore: ${v.goalFidelityScore.toFixed(3)}`,
    `- packClaimsOk: ${v.packClaimsOk}`,
    `- loops: ${v.loop}/${v.maxLoops}`,
    `- reason: ${v.reason}`,
    v.rejectReasons.length
      ? `- rejectReasons:\n${v.rejectReasons.map((r) => `  - ${r}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function verdictConsoleLine(v: AgencyVerdict): string {
  return v.reason;
}
