/** Agency OS contracts — portable across any client project. */

export type AgencyRoute =
  | "intake"
  | "architecture"
  | "operational"
  | "implement"
  | "review_only";

export type Severity = "Critical" | "High" | "Medium" | "Low";

export type RoleId =
  | "ceo_router"
  | "intake"
  | "strategist"
  | "auditor"
  | "architect"
  | "help"
  | "marketer"
  | "implementer"
  | "verifier"
  | "evidence"
  | "operator";

export type Engagement = {
  id: string;
  clientName: string;
  projectName: string;
  targetRepo: string;
  docsRoot: string;
  goal: string;
  route: AgencyRoute;
  createdAt: string;
  /** Grounded-audit: all parsed filesystem paths from the owner prompt. */
  goalPaths?: {
    targetRepos: string[];
    specRoots: string[];
    other: string[];
  };
  specRoot?: string;
  locale?: string;
  currency?: string;
};

export type RejectionIssue = {
  reason: string;
  severity: Severity;
  howToFix: string;
};

export type EvidenceHit = {
  path: string;
  kind: "file" | "dir";
  note: string;
};

export type EvidencePack = {
  targetRepo: string;
  scannedAt: string;
  hits: EvidenceHit[];
  summaryMarkdown: string;
  /** Optional v2 structured payload (also written to evidence.json). */
  json?: object;
};

export type AgencyRunResult = {
  engagement: Engagement;
  auditPassed: boolean;
  /** Strategy answers the user goal (deterministic + audit gate). */
  goalPassed?: boolean;
  goalFidelityScore?: number;
  revisionCount: number;
  strategyPlan: string;
  auditReport: string;
  layeredBlueprint: string;
  helpSystemSpec: string;
  marketingCampaign: string;
  finalReport: string;
  evidenceSummary: string;
  packDir?: string;
  reviewNo?: number;
};
