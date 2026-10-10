/**
 * Minimal upstream MCP server for MCPico's HTTP transport tests.
 *
 * Plain .mjs on purpose: MCPico discovers upstreams by spawning a command, so a
 * test fixture has to be runnable by the current node binary with no loader.
 *
 * It exposes a single tool that stamps the text it was given, which is what
 * lets a test prove a call travelled the whole way — HTTP request into MCPico,
 * over stdio into this process, back out through the HTTP response.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";

const server = new McpServer({ name: "echo-upstream", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Return the given text, stamped so its origin is unambiguous",
    inputSchema: z.object({ text: z.string() }),
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `upstream-echo:${text}` }],
  })
);

await server.connect(new StdioServerTransport());
