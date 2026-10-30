/**
 * Env for spawned Control Plane children — never the owner's real data dir.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type IsolatedCpEnv = {
  env: NodeJS.ProcessEnv;
  outputHome: string;
  databasePath: string;
  root: string;
  cleanup: () => void;
};

/**
 * Build process.env for a Control Plane child with isolated SQLite + output home.
 * Caller must cleanup() in afterAll / finally.
 */
export function makeIsolatedCpEnv(
  overrides: Record<string, string | undefined> = {}
): IsolatedCpEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sam-cp-child-"));
  const outputHome = path.join(root, "output");
  const databasePath = path.join(root, "state", "sam-harness.sqlite");
  fs.mkdirSync(outputHome, { recursive: true });
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SAM_TEST_ISOLATION: "1",
    SAM_OUTPUT_HOME: outputHome,
    SAM_DATABASE_PATH: databasePath,
    CONTROL_PLANE_NO_BROWSER: "1",
  };
  delete env.DATABASE_URL;

  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  return {
    env,
    outputHome,
    databasePath,
    root,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
