import type { CallToolResult } from "@modelcontextprotocol/server";
import type { DiscoveredServer } from "./discoverer.js";

/**
 * Forward a tool call to an upstream MCP server and return the result.
 */
export async function forwardToolCall(
  server: DiscoveredServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  return server.client.callTool({
    name: toolName,
    arguments: args,
  }) as Promise<CallToolResult>;
}
