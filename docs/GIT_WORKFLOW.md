# Git workflow — feature → staging → main

Sam-Harness uses a three-lane flow. Both **`staging`** and **`main`** are protected branches; direct pushes should be blocked (branch protection + required CI).

## Lanes

| Branch | Role |
| --- | --- |
| `feature/*` (or `cursor/*`) | Day-to-day work. Branch **from `staging`**. |
| `staging` | Integration / pre-release. All feature PRs land here first. |
| `main` | Production / release. Updated only via a release PR from `staging`. |

## Day-to-day

1. Update local staging: `git fetch origin staging && git checkout staging && git pull`.
2. Create a feature branch from staging: `git checkout -b feature/<short-name>` (Cloud Agents use `cursor/<name>-…`).
3. Open a **PR into `staging`** (not `main`).
4. **CI must pass** on that PR (`quality` on ubuntu-latest + windows-latest, including Windows desktop Notepad UIA when applicable).
5. Merge into `staging` only after review + green CI.

## Release

1. When staging is ready to ship, open a **release PR: `staging` → `main`**.
2. CI runs again on that PR (same workflow; triggers include both branches).
3. Merge into `main` only after review + green CI.
4. Tag / release notes as needed from `main`.

## CI triggers

`.github/workflows/ci.yml` runs on:

- **push** to `main` or `staging`
- **pull_request** targeting `main` or `staging`

## Protections (owner)

Configure GitHub branch protection on **`staging`** and **`main`**:

- Require a pull request before merging
- Require status checks to pass (`quality (ubuntu-latest)`, `quality (windows-latest)`)
- Disallow force pushes and deletions

Feature branches are free-form; they are not protected.
