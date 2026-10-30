# Help index — Sam-Harness

This help is grounded **strictly** in current code under `src/`, `scripts/`, `docs/`, and `tests/`.  
Anything promised in roadmaps but not shipped is marked **planned / not yet implemented**.

## How to use Help

- CLI: `pnpm run help` or `pnpm run help workflow`
- Control Plane: **Help** tab (search + topics)
- API: `GET /api/help` and `GET /api/help/:topic`
- Export agency profile pack: `pnpm run help:export` → `SAM_OUTPUT_HOME/documents/help` and `dist/help`
- Agents: “help” intents are answered from these docs

## Owner questions → topics

| Owner question | Topic |
| --- | --- |
| 1) Workflow plan, roles, diagrams | [`workflow`](workflow.md) |
| 2) Agents/models per role | [`agents-models`](agents-models.md) |
| 3) OS selection & wiring | [`selection-wiring`](selection-wiring.md) |
| 4) Local / cloud / hybrid & $0.50 cap | [`hybrid-mode`](hybrid-mode.md) |
| 5) Specialty & capability limits | [`specialty-capabilities`](specialty-capabilities.md) |
| 6) Machine control & desktop tools | [`desktop-control`](desktop-control.md) |
| 7) Customize workflow & team (table + Phase 9 visual editor) | [`customize`](customize.md) |
| Quick reply / web research (before agency) | [`quick-path`](quick-path.md) |
| Install | [`install`](install.md) |
| Security / approvals / audit | [`security`](security.md) |
| Cost | [`cost`](cost.md) |
| Troubleshooting (doctor) | [`troubleshooting`](troubleshooting.md) |
| FAQ | [`faq`](faq.md) |
| Glossary | [`glossary`](glossary.md) |

## One-line product truth

Sam-Harness is an Arabic-first hybrid agency: **Control Plane** + **LangGraph review** + **Windows desktop operator (real UIA)** + numbered report packs. It is not a general website builder, and not full GUI automation on Linux/macOS.
