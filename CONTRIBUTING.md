# Contributing to Sam-Harness

English guide for humans and AI agents. The only supported push path is:

**feature branch → PR into `staging` (CI green) → release PR `staging` → `main`**

Direct pushes to `main` / `staging` are blocked by GitHub branch protection **and** local git hooks.

## Flow diagram

```mermaid
flowchart LR
  A["feat/* / fix/* / chore/* / docs/* / cursor/*"] -->|PR + CI| B[staging]
  B -->|release PR + CI| C[main]
```

## Quick start (do it right in one command)

```bash
# 1) Install deps (also enables versioned hooks via prepare)
pnpm install

# 2) Start a branch from latest staging
pnpm run git:new-branch -- feat/my-change

# 3) Commit (Conventional Commits enforced by commit-msg hook)
git commit -m "feat: my change"

# 4) Open PR into staging
pnpm run git:open-pr
# or: pnpm run git:open-pr -- "feat: my change"
```

**Windows PowerShell 5.1**

```powershell
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\new-branch.ps1 -Name feat/my-change
# ... commits ...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\open-pr.ps1 -Title "feat: my change"
```

**Git Bash (Windows) / macOS / Linux** — same `pnpm` / `bash scripts/git/*.sh` commands as above.

## Branch rules

| Target (`base`) | Allowed head | Notes |
| --- | --- | --- |
| `staging` | `feat/*`, `fix/*`, `chore/*`, `docs/*`, `feature/*`, `hotfix/*`, `refactor/*`, `test/*`, `ci/*`, `build/*`, `perf/*`, `style/*`, `cursor/*`, `sync/*`, `dependabot/*` | Day-to-day work |
| `main` | **`staging` only** | Release PR |

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/), e.g. `feat: add X`, `fix(ui): correct Y`. Release PRs may also use `Release: …`.

## Enforcement layers

1. **GitHub branch protection** (already on) — no direct push; required checks; strict up-to-date; enforce admins.
2. **GitHub Actions `branch-flow`** — fails illegal PRs (wrong base/head/title). Stable check name: **`branch-flow`**.
3. **Local hooks** (`.githooks/`, `core.hooksPath`) — `pre-push` blocks pushes to `main`/`staging` and bad branch names; `commit-msg` requires Conventional Commits.
4. **Helpers** — `git:new-branch` / `git:open-pr` always base on / target `staging`.

Enable hooks manually if needed:

```bash
pnpm run git:setup-hooks
# or: bash scripts/git/setup-hooks.sh
# or: powershell -File scripts\git\setup-hooks.ps1
```

## CI checks

| Check name | Role |
| --- | --- |
| `quality (ubuntu-latest)` | Typecheck, tests, smokes (required today) |
| `quality (windows-latest)` | Same + PowerShell 5.1 Tools smoke (required today) |
| `quality (macos-latest)` | Same matrix (present; make required if desired) |
| **`branch-flow`** | PR lane/name/title guard — **add as a required status check** |

## Troubleshooting

### Protected branch rejection / “direct push” denied

You tried to push `main` or `staging`. Create a feature branch and open a PR:

```bash
pnpm run git:new-branch -- feat/my-fix
pnpm run git:open-pr
```

### `branch-flow` CI fails: PR into main from non-staging

Only `staging` → `main` is allowed. Merge your feature PR into `staging` first, then open the release PR.

### `branch-flow` CI fails: bad branch name

Rename / recreate with an allowed prefix (`feat/…`, `fix/…`, …) from latest `staging`.

### `gh` / push: needs Write permission / wrong account / token scopes

1. Check identity: `gh auth status` and `git remote -v`.
2. Classic personal access token needs the **`repo`** scope.
3. Fine-grained token needs **Contents** + **Pull requests** (read and write) on **this** repository.
4. Re-login: `gh auth login` and pick the account that has Write on `HFakhry81/Sam-Harness`.

### Hooks not running

```bash
git config --get core.hooksPath   # expect: .githooks
pnpm run git:setup-hooks
```

On Windows, Git runs hook scripts with its bundled Bash — install Git for Windows if hooks are skipped.

### Commit rejected by `commit-msg`

Use Conventional Commits: `feat: …`, `fix: …`, `chore: …`. Merge and `Revert` subjects are allowed.

## Docs for agents

See **`AGENTS.md`** (machine-oriented rules) and **`docs/GIT_WORKFLOW.md`** (short lane summary).
