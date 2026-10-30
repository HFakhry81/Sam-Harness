#!/usr/bin/env tsx
/**
 * Phase 6 trust CLI — verify audit chain, list/decide approvals, fetch evidence.
 *
 * Usage:
 *   pnpm run trust:verify
 *   pnpm run trust:approvals
 *   pnpm run trust:approve -- <id>
 *   pnpm run trust:deny -- <id>
 *   pnpm run trust:evidence -- <runId>
 */
import "../src/lib/loadEnv.js";
import {
  initPersistenceSync,
  getPersistence,
} from "../src/lib/db/index.js";
import {
  verifyAuditChain,
  listAudit,
  listPendingApprovals,
  listAllApprovals,
  decideApproval,
  writeEvidenceBundle,
  readEvidenceBundle,
  getEffectiveTrustPolicy,
} from "../src/lib/trust/index.js";

function usage(): never {
  console.log(`Sam-Harness trust CLI (Phase 6)

Commands:
  verify              Verify hash-chained audit log integrity
  approvals [all]     List pending (or all) approvals
  approve <id>        Approve a pending approval
  deny <id>           Deny a pending approval
  evidence <runId>    Write/read evidence bundle for a run
  policy              Print effective trust policy
  audit [limit]       List recent audit entries
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = (args[0] || "").toLowerCase();
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") usage();

  initPersistenceSync({ skipBackup: true });
  getPersistence();

  if (cmd === "verify") {
    const result = verifyAuditChain();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  }

  if (cmd === "approvals") {
    const all = (args[1] || "").toLowerCase() === "all";
    const rows = all ? listAllApprovals() : listPendingApprovals();
    console.log(JSON.stringify({ ok: true, count: rows.length, approvals: rows }, null, 2));
    return;
  }

  if (cmd === "approve" || cmd === "deny") {
    const id = args[1];
    if (!id) {
      console.error("Usage: trust:approve|deny <approvalId>");
      process.exit(1);
    }
    const record = decideApproval(id, cmd === "approve");
    if (!record) {
      console.error(JSON.stringify({ ok: false, error: "approval not found" }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, approval: record }, null, 2));
    return;
  }

  if (cmd === "evidence") {
    const runId = args[1];
    if (!runId) {
      console.error("Usage: trust:evidence <runId>");
      process.exit(1);
    }
    let bundle = readEvidenceBundle(runId);
    if (!bundle) {
      bundle = writeEvidenceBundle({ runId });
    }
    if (!bundle) {
      console.error(JSON.stringify({ ok: false, error: "evidence disabled or write failed" }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, bundle }, null, 2));
    return;
  }

  if (cmd === "policy") {
    console.log(JSON.stringify({ ok: true, policy: getEffectiveTrustPolicy() }, null, 2));
    return;
  }

  if (cmd === "audit") {
    const limit = Math.max(1, Number(args[1] || 50));
    const entries = listAudit({ limit });
    console.log(JSON.stringify({ ok: true, count: entries.length, entries }, null, 2));
    return;
  }

  usage();
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
