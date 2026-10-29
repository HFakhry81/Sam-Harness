import type { RoleId } from "./types.js";

export type RoleContract = {
  id: RoleId;
  title: string;
  mission: string;
  prefersCloud: boolean;
  outputs: string[];
};

/** Fixed agency org chart — zero-cost hybrid team. */
export const AGENCY_ROLES: RoleContract[] = [
  {
    id: "ceo_router",
    title: "CEO Router",
    mission: "Classify intent; open/close gates; never fake success.",
    prefersCloud: false,
    outputs: ["route", "gate_decision"],
  },
  {
    id: "intake",
    title: "Intake Analyst",
    mission: "Normalize client brief into engagement + success criteria.",
    prefersCloud: false,
    outputs: ["engagement.json"],
  },
  {
    id: "evidence",
    title: "Evidence Scout",
    mission: "Scan target repo/docs; produce citable path hits before audit.",
    prefersCloud: false,
    outputs: ["evidence-pack.md"],
  },
  {
    id: "strategist",
    title: "Strategist",
    mission: "Write concrete production strategy; merge rejection fixes into full rewrites.",
    prefersCloud: true,
    outputs: ["strategy-vN.md"],
  },
  {
    id: "auditor",
    title: "Security & Logic Auditor",
    mission: "Approve only with evidence; reject with reason/severity/fix.",
    prefersCloud: true,
    outputs: ["audit-vN.md", "rejection-vN.md"],
  },
  {
    id: "architect",
    title: "Solution Architect",
    mission: "N-tier blueprint + gap matrix + backlog after APPROVED only.",
    prefersCloud: true,
    outputs: ["execution-plan.md", "CODE_VS_PLAN_GAP_MATRIX.md"],
  },
  {
    id: "help",
    title: "Help Systems",
    mission: "In-app help for multi-purpose ops (not vertical-locked wording).",
    prefersCloud: true,
    outputs: ["help-system-spec.md"],
  },
  {
    id: "marketer",
    title: "GTM Marketer",
    mission: "Honest campaign; never over-claim unfinished integrations.",
    prefersCloud: true,
    outputs: ["marketing-campaign.md"],
  },
  {
    id: "verifier",
    title: "CEO Verifier",
    mission: "Check deliverables vs task; fail if audit gate closed.",
    prefersCloud: false,
    outputs: ["final-report.md"],
  },
  {
    id: "implementer",
    title: "Implementer",
    mission: "Code changes only when owner authorizes; otherwise skip.",
    prefersCloud: true,
    outputs: ["EXECUTION_JOURNAL.md"],
  },
  {
    id: "operator",
    title: "Desktop Operator",
    mission: "Safe local PC ops: open files, screenshot, copy within allowlist.",
    prefersCloud: false,
    outputs: ["tool results"],
  },
];

export function roleById(id: RoleId): RoleContract {
  const hit = AGENCY_ROLES.find((r) => r.id === id);
  if (!hit) throw new Error(`Unknown role: ${id}`);
  return hit;
}
