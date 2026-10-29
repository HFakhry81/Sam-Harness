# Sam-Harness — Review Loop Workflow (Level-2)

## Problem this solves
Rejecting a strategy then **continuing under caution** ships a known-bad plan into Architect/Help/Marketer. That is forbidden.

## Loop model (best-practice critique → remediate → re-audit)

```
R = 1 .. 5
  Strategist produces strategy-v{R}.md
    if R > 1: merge (strategy-v{R-1} + rejection-v{R-1} fixes) → full new plan
  Auditor produces audit-v{R}.md + rejection-v{R}.md (if rejected)
    each issue: أسباب الرفض | درجة الخطورة | طريقة الحل
  if [APPROVED] → open gate to Architect
  if [REJECTED] → R++ and remediate (never skip fixes)
if still REJECTED after R=5 → STOP. Archive FAILED pack. Do not run Architect/Help/Marketer as success.
```

## Numbering
- Every loop iteration has its own report numbers: `strategy-vN`, `audit-vN`, `rejection-vN`, `remediation-brief-vN`
- Final archive still goes to project `docs/Sam-Harness no.X` (run-level archive)

## Gate
Downstream stages run **only** after Auditor `[APPROVED]`.
