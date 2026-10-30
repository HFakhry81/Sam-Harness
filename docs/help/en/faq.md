# FAQ

**Can it build websites?**  
Partially: it can write files/plans and apply patches after GO — not a visual page builder.

**Can it do daily Ubuntu work?**  
Yes for files, scheduler, email, MCP, models, allowlisted shell, and GUI when `wmctrl`/`xdotool`/`scrot` (or Wayland equivalents) are installed. See desktop-control.

**Does it need internet?**  
For paid cloud, yes. Local Ollama path can run without cloud.

**Where are reports?**  
Under `SAM_OUTPUT_HOME` — usually `Documents/Sam-Harness`, with numbered packs under reports/docs depending on path.

**How do I change language?**  
`SAM_LOCALE=ar|en` or the locale switch in the UI header.

**Difference between help role and product Help?**  
Role `help` writes `help-system-spec.md` inside an analysis pack. Product Help is `docs/help` + `pnpm run help` + the UI tab.

**Can it exceed the $0.50 cap?**  
Not automatically. Raise the cap in the hybrid profile if you want; the system refuses charges that would exceed the cap.

**How do I change a role’s model?**  
`config/team.json`, Control Plane → Team, or `SAM_ROLE_<ROLE>_MODEL` / `_CLOUD_MODEL`.

**Can I reorder specialists?**  
Yes — Team tab / `POST /api/team/pipeline`. Review loop and GO gate stay fixed.
