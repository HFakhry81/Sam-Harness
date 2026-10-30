#!/usr/bin/env tsx
/**
 * `pnpm run doctor` - local health / diagnostics (no network).
 */
import { formatDoctorReport, runDoctor } from "../src/lib/doctor/index.js";

const json = process.argv.includes("--json");
const probe = process.argv.includes("--probe-ollama");

const report = runDoctor({
  cwd: process.cwd(),
  probeOllama: probe,
});

if (json) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  process.stdout.write(formatDoctorReport(report));
}

process.exit(report.ok ? 0 : 1);
