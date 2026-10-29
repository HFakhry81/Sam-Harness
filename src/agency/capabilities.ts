/**
 * Role → tool capability matrix for real PC environments.
 * Default: least privilege. Implement/write requires GO + role allow.
 */
import type { RoleId } from "./types.js";

export type ToolName =
  | "list_dir"
  | "read_file"
  | "write_file"
  | "write_excel"
  | "mkdir"
  | "delete_path"
  | "move_file"
  | "copy_file"
  | "open_path"
  | "screenshot"
  | "run_shell"
  | "finish"
  | "scan_evidence"
  | "write_report";

export type CapabilityTier = "none" | "read" | "ops_safe" | "write_workspace" | "implement";

export type RoleCapabilities = {
  role: RoleId;
  tier: CapabilityTier;
  tools: ToolName[];
  /** Human-readable limits on a real PC */
  limits: string[];
};

const READ_TOOLS: ToolName[] = ["list_dir", "read_file", "finish", "scan_evidence"];
const REPORT_TOOLS: ToolName[] = [...READ_TOOLS, "write_report"];
/** Desktop operator: create/edit/delete inside allowlisted roots (delete needs confirm:true) */
const OPS_TOOLS: ToolName[] = [
  ...READ_TOOLS,
  "write_file",
  "write_excel",
  "mkdir",
  "delete_path",
  "open_path",
  "screenshot",
  "copy_file",
  "move_file",
  "run_shell",
];
const WRITE_TOOLS: ToolName[] = [...OPS_TOOLS, "write_report"];

export const ROLE_CAPABILITIES: RoleCapabilities[] = [
  {
    role: "ceo_router",
    tier: "read",
    tools: ["finish", "read_file", "list_dir"],
    limits: ["Routing only", "No file mutations", "No shell"],
  },
  {
    role: "intake",
    tier: "write_workspace",
    tools: [...REPORT_TOOLS, "write_file"],
    limits: ["May write engagement.json in Sam-Harness cwd only", "No client repo edits"],
  },
  {
    role: "evidence",
    tier: "read",
    tools: [...READ_TOOLS],
    limits: ["Read-only scan of targetRepo", "No delete/move", "No install"],
  },
  {
    role: "strategist",
    tier: "write_workspace",
    tools: [...REPORT_TOOLS, "write_file"],
    limits: ["Reports under cwd / review-loop / pack docs only", "No client app source"],
  },
  {
    role: "auditor",
    tier: "read",
    tools: [...READ_TOOLS, "write_report"],
    limits: ["Read evidence + strategy", "Write audit/rejection reports only", "Cannot approve without evidence"],
  },
  {
    role: "architect",
    tier: "write_workspace",
    tools: [...REPORT_TOOLS, "write_file"],
    limits: ["Plans/backlog/gap matrix only", "No production code without GO"],
  },
  {
    role: "help",
    tier: "write_workspace",
    tools: [...REPORT_TOOLS, "write_file"],
    limits: ["help-system-spec.md only class of outputs"],
  },
  {
    role: "marketer",
    tier: "write_workspace",
    tools: [...REPORT_TOOLS, "write_file"],
    limits: ["Marketing docs only", "Must not claim unfinished integrations as live"],
  },
  {
    role: "verifier",
    tier: "read",
    tools: [...READ_TOOLS, "write_report"],
    limits: ["Verify vs task", "Cannot reopen audit gate alone"],
  },
  {
    role: "implementer",
    tier: "implement",
    tools: WRITE_TOOLS,
    limits: [
      "Requires Go/No-Go = GO",
      "Target only authorized repo path",
      "Shell still allowlisted (no arbitrary install/rm)",
      "Blocked: Windows/Program Files system paths",
    ],
  },
];

/** Desktop operator used by Level-1 operational loop (not a planning specialist). */
export const OPERATOR_CAPABILITIES: RoleCapabilities = {
  role: "operator",
  tier: "ops_safe",
  tools: OPS_TOOLS,
  limits: [
    "Allowlisted roots: cwd, Desktop, Documents, Downloads, home (+ D:/E: on Windows)",
    "delete_path requires confirm:true; recursive:true for non-empty dirs",
    "Blocked: OS system folders (Windows/Program Files, /etc, /System, …)",
    "Shell: dir/type/echo/where/Get-* only",
  ],
};

export function capabilitiesFor(role: RoleId): RoleCapabilities {
  if (role === "operator") return OPERATOR_CAPABILITIES;
  const hit = ROLE_CAPABILITIES.find((r) => r.role === role);
  if (!hit) throw new Error(`No capabilities for role ${role}`);
  return hit;
}

export function assertToolAllowed(role: RoleId, tool: string): void {
  const caps = capabilitiesFor(role);
  if (tool === "finish") return;
  if (!caps.tools.includes(tool as ToolName)) {
    throw new Error(
      `Role ${role} cannot use tool "${tool}". Allowed: ${caps.tools.join(", ")}`
    );
  }
}

export function renderCapabilitiesMarkdown(): string {
  const lines = [
    `# Role capability matrix`,
    ``,
    `| Role | Tier | Tools | Limits |`,
    `| --- | --- | --- | --- |`,
  ];
  for (const r of ROLE_CAPABILITIES) {
    lines.push(
      `| ${r.role} | ${r.tier} | ${r.tools.join(", ")} | ${r.limits.join("; ")} |`
    );
  }
  lines.push("");
  lines.push("## Desktop operator (L1 operational)");
  lines.push(
    `| operator (via ceo loop) | ${OPERATOR_CAPABILITIES.tier} | ${OPERATOR_CAPABILITIES.tools.join(", ")} | ${OPERATOR_CAPABILITIES.limits.join("; ")} |`
  );
  return lines.join("\n");
}
