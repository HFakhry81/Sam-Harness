import { executeTool, type ToolResult } from "../tools/registry.js";
import { assertToolAllowed, type RoleCapabilities } from "./capabilities.js";
import type { RoleId } from "./types.js";

/**
 * Role-gated tool execution for real PC environments.
 */
export async function executeToolAsRole(
  role: RoleId,
  tool: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  try {
    assertToolAllowed(role, tool);
  } catch (e: any) {
    return {
      ok: false,
      tool,
      message: e?.message || String(e),
      data: { role, denied: true },
    };
  }
  return executeTool(tool, params);
}

export function describeRoleAccess(caps: RoleCapabilities): string {
  return `${caps.role} [${caps.tier}]: ${caps.tools.join(", ")}`;
}
