/** Delivery OS — living backlog for any client engagement. */

export type TicketStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "review"
  | "done"
  | "blocked"
  | "cancelled";

export type TicketPriority = "P0" | "P1" | "P2" | "P3";

export type DefinitionOfDoneItem = {
  id: string;
  label: string;
  done: boolean;
};

export type DeliveryTicket = {
  id: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  why: string;
  filesLikely: string[];
  acceptance: string[];
  dod: DefinitionOfDoneItem[];
  evidenceRefs: string[];
  blockedReason?: string;
  updatedAt: string;
  createdAt: string;
};

export type GoNoGoDecision = "GO" | "NO_GO" | "PENDING";

export type GoNoGoRecord = {
  decision: GoNoGoDecision;
  by: string;
  at: string;
  reason: string;
  engagementId?: string;
  packDir?: string;
};

export type DeliveryBoard = {
  version: 1;
  engagementId: string;
  targetRepo: string;
  packDir?: string;
  updatedAt: string;
  goNoGo: GoNoGoRecord;
  tickets: DeliveryTicket[];
};

export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "backlog", "cancelled", "blocked"],
  in_progress: ["review", "blocked", "ready"],
  review: ["done", "in_progress", "blocked"],
  done: [],
  blocked: ["ready", "in_progress", "cancelled"],
  cancelled: [],
};

export const DEFAULT_DOD: Omit<DefinitionOfDoneItem, "done">[] = [
  { id: "dod-acceptance", label: "Acceptance criteria written and testable" },
  { id: "dod-evidence", label: "Evidence paths cited (or explicit not-found)" },
  { id: "dod-review", label: "Peer/agent review passed or waived with reason" },
  { id: "dod-smoke", label: "Smoke/check command identified" },
  { id: "dod-no-scope-creep", label: "Change stays within ticket scope" },
];
