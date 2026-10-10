import { toNodeHandler } from "@modelcontextprotocol/node";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { CallToolResult, McpHttpHandler } from "@modelcontextprotocol/server";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod/v4";
import type { MCPicoConfig } from "./config.js";
import { validateServerConfig } from "./config.js";
import {
  discoverServer,
  disconnectServer,
  type DiscoveredServer,
} from "./discoverer.js";
import { groupTools, type ToolGroup } from "./grouper.js";
import { parseCommand } from "./parser.js";
import { generateHelpText } from "./help.js";
import { forwardToolCall } from "./proxy.js";
import type { ResolvedListenAuth } from "./auth-types.js";
import { resolveUpstreamAuth, resolveListenAuth, extractBearerTokenFromHeader, validateBearerToken, unauthorizedResponse } from "./auth.js";

/** Helper: create a simple text content result */
export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Merge tool groups from multiple upstream servers.
 *
 * Groups with the same name are merged:
 * - Tools are concatenated
 * - serverName is joined with " + "
 */
export function mergeGroups(allGroups: ToolGroup[]): Map<string, ToolGroup> {
  const mergedGroups = new Map<string, ToolGroup>();
  for (const group of allGroups) {
    const existing = mergedGroups.get(group.groupName);
    if (existing) {
      existing.tools.push(...group.tools);
      if (!existing.serverName.includes(group.serverName)) {
        existing.serverName += ` + ${group.serverName}`;
      }
    } else {
      mergedGroups.set(group.groupName, { ...group });
    }
  }
  return mergedGroups;
}

/**
 * Execute a known subcommand against an upstream server.
 *
 * Resolves the server, validates the tool exists in the group,
 * and forwards the call. Used by both the legacy command-based
 * handler and the split help/execute design.
 *
 * Exported for testing; allows injecting a mock forwardFn.
 */
export async function executeSubcommand(
  subcommand: string,
  args: Record<string, unknown>,
  group: ToolGroup,
  servers: DiscoveredServer[],
  forwardFn: (
    server: DiscoveredServer,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResult> = forwardToolCall
): Promise<CallToolResult> {
  const upstreamTool = group.tools.find((t) => t.name === subcommand);
  if (!upstreamTool) {
    const available = group.tools.map((t) => t.name).join(", ");
    return textResult(
      `Unknown subcommand: "${subcommand}"\n\nAvailable in ${group.groupName}: ${available}\n\nUse 'help_${group.groupName}' to see full documentation.`
    );
  }

  const serverForTool = servers.find((s) =>
    s.tools.some((t) => t.name === subcommand)
  );

  if (!serverForTool) {
    return textResult(
      `Internal error: could not find upstream server for tool "${subcommand}"`
    );
  }

  try {
    const result = await forwardFn(serverForTool, subcommand, args);
    return result;
  } catch (err) {
    return textResult(
      `Error calling "${subcommand}": ${(err as Error).message}`
    );
  }
}

/**
 * Handle a tool call command for a given group (legacy merged mode).
 *
 * Parses a command string like 'help' or 'subcommand {"key":"value"}'
 * and dispatches to executeSubcommand. Retained for backward compatibility
 * and testing.
 */
export async function handleToolCall(
  command: string,
  group: ToolGroup,
  servers: DiscoveredServer[],
  helpText: string,
  forwardFn: (
    server: DiscoveredServer,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResult> = forwardToolCall
): Promise<CallToolResult> {
  const parsed = parseCommand(command);

  if (parsed.isHelp) {
    return textResult(helpText);
  }

  if (parsed.error) {
    return textResult(parsed.error);
  }

  return executeSubcommand(parsed.subcommand!, parsed.args, group, servers, forwardFn);
}

/**
 * Build the description string for a help_<group> discovery tool.
 */
export function buildHelpDescription(group: ToolGroup): string {
  const toolCount = group.tools.length;
  return [
    `List all ${group.groupName} subcommands (${toolCount} available) with their parameters.`,
    `Call help_${group.groupName} first, then use the '${group.groupName}' tool to execute.`,
  ].join(" ");
}

/**
 * Build the description string for an execution group tool.
 */
export function buildGroupDescription(group: ToolGroup): string {
  const toolCount = group.tools.length;
  const subcommands = group.tools.map((t) => t.name.replace(`${group.groupName}_`, "")).slice(0, 5).join(", ");
  const show = toolCount > 5 ? subcommands + ",..." : subcommands;
  return [
    `Execute ${group.groupName} operations. Call help_${group.groupName} first to discover subcommands.`,
    `Set subcommand to "${group.groupName}_<operation>" with params.`,
    `Available: ${show} (${toolCount} total)`,
  ].join(" ");
}

/**
 * Validate all server configs, returning an array of error messages.
 * Returns empty array if all configs are valid.
 */
export function validateAllServerConfigs(servers: MCPicoConfig["servers"]): string[] {
  const errors: string[] = [];
  for (const serverConfig of servers) {
    const err = validateServerConfig(serverConfig);
    if (err) {
      errors.push(err);
    }
  }
  return errors;
}

/**
 * Start the MCPico proxy server.
 *
 * 1. Validate config
 * 2. Connect to all upstream servers
 * 3. Discover and group their tools
 * 4. Register grouped tools on the MCPico server
 * 5. Listen for client connections
 */
export interface ServerContext {
  mergedGroups: Map<string, ToolGroup>;
  servers: DiscoveredServer[];
}

/**
 * A running MCPico instance. Returned by startServer so callers — including
 * tests — can tell where it is listening and stop it without exiting the
 * process.
 */
export interface RunningServer {
  /** Stop serving: disconnect upstreams, then close the client-facing side. */
  close(): Promise<void>;
  /** The bound HTTP address, or undefined when serving over stdio. */
  address(): { host: string; port: number } | undefined;
}


/**
 * Build one fully-registered MCPico server.
 *
 * HTTP serving is per-request in SDK v2: a server and transport serve exactly
 * one connection, so a shared instance answers the first request and fails the
 * next. This is a plain factory — every instance registers the same surface
 * from the same shared context, reads nothing request-specific, and mutates
 * nothing.
 *
 * Deliberately silent: it runs once per request, so the startup log lines
 * belong to startServer.
 */
export function buildServer(context: ServerContext): McpServer {
  const { mergedGroups, servers } = context;

  const server = new McpServer(
    { name: "MCPico", version: "0.2.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        "MCPico bundles upstream MCP tools into hierarchical groups. " +
        "Each group has two tools: help_<group> (discovery) and <group> (execution). " +
        "Call help_<group> first to see available subcommands and their parameters, " +
        "then call <group> with subcommand='<group>_<operation>' and params={...}.",
    }
  );

  // Register each group as two tools: help_<group> + <group>
  for (const [groupName, group] of mergedGroups) {
    const toolCount = group.tools.length;
    const helpText = generateHelpText(group);

    // Discovery tool: help_<group>
    server.registerTool(
      `help_${groupName}`,
      {
        title: `MCPico: help_${groupName}`,
        description: buildHelpDescription(group),
        inputSchema: z.object({}),
      },
      async () => {
        return textResult(helpText);
      }
    );

    // Execution tool: <group>
    server.registerTool(
      groupName,
      {
        title: `MCPico: ${groupName}`,
        description: buildGroupDescription(group),
        inputSchema: z.object({
          subcommand: z
            .string()
            .describe(
              `The ${groupName} operation to run, e.g. "${groupName}_read_file" or "${groupName}_query". ` +
                `${toolCount} subcommand${toolCount === 1 ? "" : "s"} available.`
            ),
          params: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Parameters to pass to the subcommand as key-value pairs"),
        }),
      },
      async (args: { subcommand: string; params?: Record<string, unknown> }) => {
        return executeSubcommand(
          args.subcommand,
          args.params || {},
          group,
          servers
        );
      }
    );

  }

  // Pass through resources from all upstream servers
  for (const upstream of servers) {
    for (const res of upstream.resources) {
      const namespacedUri = `mcpico://${upstream.name}/${res.uri}`;
      const displayName = `${upstream.name}: ${res.name}`;

      server.registerResource(
        displayName,
        namespacedUri,
        {
          description: `${res.description || res.name} (from ${upstream.name})`,
          mimeType: res.mimeType,
        },
        async () => {
          const result = await upstream.client.readResource({ uri: res.uri });
          return {
            contents: result.contents || [],
          };
        }
      );
    }
  }

  // Pass through prompts from all upstream servers
  for (const upstream of servers) {
    for (const prompt of upstream.prompts) {
      const namespacedName = `${upstream.name}_${prompt.name}`;

      const argShape: Record<string, ReturnType<typeof z.string>> = {};
      for (const arg of prompt.arguments || []) {
        argShape[arg.name] = z
          .string()
          .describe(
            arg.description ||
              `Argument: ${arg.name}${arg.required ? " (required)" : ""}`
          );
      }

      server.registerPrompt(
        namespacedName,
        {
          title: `${upstream.name}: ${prompt.name}`,
          description: `${prompt.description || ""} (from ${upstream.name})`,
          argsSchema:
            Object.keys(argShape).length > 0 ? z.object(argShape) : undefined,
        },
        async (args) => {
          const promptArgs: Record<string, string> = {};
          if (args && typeof args === "object") {
            for (const [k, v] of Object.entries(
              args as Record<string, unknown>
            )) {
              promptArgs[k] = String(v);
            }
          }
          const result = await upstream.client.getPrompt({
            name: prompt.name,
            arguments: promptArgs,
          });
          return {
            messages: result.messages || [],
          };
        }
      );
    }
  }

  return server;
}

export async function startServer(config: MCPicoConfig): Promise<RunningServer> {
  const separator = config.separator || "_";
  const servers: DiscoveredServer[] = [];
  const allGroups: ToolGroup[] = [];

  // Validate server configs
  const validationErrors = validateAllServerConfigs(config.servers);
  if (validationErrors.length > 0) {
    console.error("Configuration errors:");
    for (const err of validationErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Connect to all upstream servers and discover tools
  console.error(
    `MCPico starting with ${config.servers.length} upstream server(s)...`
  );

  for (const serverConfig of config.servers) {
    try {
      const transportLabel =
        serverConfig.transport.type === "sse"
          ? serverConfig.transport.url
          : serverConfig.transport.command;
      console.error(`  Connecting to "${serverConfig.name}" (${serverConfig.transport.type}: ${transportLabel})...`);
      const resolvedAuth = serverConfig.auth
        ? resolveUpstreamAuth(serverConfig.auth)
        : undefined;
      const discovered = await discoverServer(
        serverConfig.name,
        serverConfig.transport,
        serverConfig.connectTimeoutMs,
        resolvedAuth
      );
      servers.push(discovered);

      const groups = groupTools(
        serverConfig.name,
        discovered.tools,
        separator,
        config.groups
      );

      console.error(
        `  → ${discovered.tools.length} tools → ${groups.length} groups: ${groups.map((g) => g.groupName).join(", ")}`
      );

      allGroups.push(...groups);
    } catch (err) {
      console.error(
        `  Failed to connect to "${serverConfig.name}":`,
        (err as Error).message
      );
    }
  }

  if (servers.length === 0) {
    console.error("No upstream servers connected. Exiting.");
    process.exit(1);
  }

  // Build lookup: groupName → ToolGroup (merged across servers)
  const mergedGroups = mergeGroups(allGroups);

  const context: ServerContext = { mergedGroups, servers };

  // Registration is per serving unit (see buildServer); report the shape once.
  for (const [groupName, group] of mergedGroups) {
    console.error(`  Registered: help_${groupName} + ${groupName} (${group.tools.length} tools)`);
  }
  const resourceCount = servers.reduce((n, s) => n + s.resources.length, 0);
  const promptCount = servers.reduce((n, s) => n + s.prompts.length, 0);
  if (resourceCount > 0) {
    console.error(`  Registered ${resourceCount} resource(s)`);
  }
  if (promptCount > 0) {
    console.error(`  Registered ${promptCount} prompt(s)`);
  }
  // Serve the client over the configured transport
  const listenConfig = config.listen || { type: "stdio" };
  let httpServer: HttpServer | undefined;
  let mcpHandler: McpHttpHandler | undefined;
  let stdioServer: McpServer | undefined;

  if (listenConfig.type === "sse") {
    // Resolve listen auth
    let listenAuth: ResolvedListenAuth | undefined;
    if (listenConfig.auth) {
      listenAuth = resolveListenAuth(listenConfig.auth);
    }

    // One handler for the endpoint. It classifies each exchange and asks the
    // factory for a fresh instance, which is what v2 requires — a server and
    // transport serve exactly one connection, so a shared instance answers the
    // first request and fails the next. `legacy: "stateless"` keeps 2025-era
    // clients (everything that exists today) working, one instance per request.
    mcpHandler = createMcpHandler(() => buildServer(context), {
      legacy: "stateless",
      onerror: (error) => console.error("MCPico HTTP error:", error.message),
    });
    const handler = mcpHandler;

    // toNodeHandler builds a Web Request from the node request and lets the
    // transport read the body. The stream must not be drained first: handing
    // over an empty or already-consumed body answers 400 ("Parse error: Invalid
    // JSON-RPC message") on every request, which is what this mode used to do.
    const nodeHandler = toNodeHandler({
      fetch: async (request, options) => {
        // Auth check
        if (listenAuth) {
          const providedToken = extractBearerTokenFromHeader(
            request.headers.get("authorization")
          );
          if (!validateBearerToken(providedToken, listenAuth.token)) {
            return unauthorizedResponse();
          }
        }

        return handler.fetch(request, options);
      },
    });

    httpServer = createServer(nodeHandler);
    const host = listenConfig.host || "localhost";
    await new Promise<void>((resolve, reject) => {
      httpServer!.once("error", reject);
      httpServer!.listen(listenConfig.port, host, resolve);
    });
    const { port: boundPort } = httpServer.address() as AddressInfo;
    console.error(
      `MCPico ready — ${mergedGroups.size} group(s), ${servers.length} upstream server(s) — listening on http://${host}:${boundPort}`
    );
  } else {
    stdioServer = buildServer(context);
    await stdioServer.connect(new StdioServerTransport());
    console.error(
      `MCPico ready — ${mergedGroups.size} group(s), ${servers.length} upstream server(s)`
    );
  }

  // Shut down cleanly: upstreams first, then whatever is serving the client.
  let shuttingDown = false;
  const close = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("Shutting down...");
    for (const s of servers) {
      await disconnectServer(s);
    }
    if (mcpHandler) {
      await mcpHandler.close();
    }
    if (stdioServer) {
      await stdioServer.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void close().then(() => process.exit(0));
    });
  }

  return {
    close,
    address: () => {
      const addr = httpServer?.address();
      return addr && typeof addr !== "string"
        ? { host: addr.address, port: addr.port }
        : undefined;
    },
  };
}
