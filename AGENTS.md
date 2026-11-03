# AGENTS.md — Sam-Harness

Rules for AI coding agents (Cursor Cloud Agents, Assistants, etc.). Humans: see `CONTRIBUTING.md`.

## Git workflow (mandatory)

1. **Never** push directly to `main` or `staging`.
2. **Never** open a feature PR against `main`.
3. Always branch from **latest `origin/staging`**.
4. Use an allowed branch name:
   - Humans: `feat/*`, `fix/*`, `chore/*`, `docs/*` (also `feature/*`, `hotfix/*`, …)
   - Cursor Cloud Agents: `cursor/<descriptive-name>-<id>` (required by agent policy)
5. Open the PR with **`--base staging`** (`gh pr create --base staging`).
6. Wait for CI: `quality (ubuntu-latest)`, `quality (windows-latest)`, and **`branch-flow`**.
7. Release only via a separate PR: **`staging` → `main`**. Do not merge unless explicitly asked.

Helpers (preferred):

```bash
pnpm run git:new-branch -- cursor/my-change-xxxx
pnpm run git:open-pr -- "chore: my change"
```

Local hooks live in `.githooks/` and are enabled by `pnpm install` (`prepare` → `scripts/git/setup-hooks.mjs`).

## Do not

- Modify `config/team.json` unless the user explicitly requests it.
- Write generated reports / run packs into the git repo (`SAM_OUTPUT_HOME` only).
- Bypass or delete the `branch-flow` workflow or hooks to “just push”.
- Force-push to `main` / `staging`.

## PR expectations

- Title: Conventional Commits (`feat:`, `fix:`, `chore:`, …).
- Fill `.github/PULL_REQUEST_TEMPLATE.md`.
- Keep CI green on ubuntu / windows / macOS matrix jobs that apply.
- Prefer English-only ASCII for console scripts (Tools / install / git helpers).

## Project pointers

| Path | Role |
| --- | --- |
| `CONTRIBUTING.md` | Full contributor workflow + troubleshooting |
| `docs/GIT_WORKFLOW.md` | Short lane chart |
| `scripts/git/` | Branch helpers + PR flow checker |
| `.githooks/` | `pre-push`, `commit-msg` |
| `.github/workflows/branch-flow.yml` | Guard job name: **`branch-flow`** |
| `.github/workflows/ci.yml` | Quality matrix |
