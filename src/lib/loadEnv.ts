/**
 * Load .env before any agent/model module reads process.env.
 * Must be imported first from entrypoints (side-effect import).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

dotenv.config({
  path: path.join(root, ".env"),
  override: false,
  quiet: true,
});
