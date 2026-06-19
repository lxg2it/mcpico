import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TransportConfig } from "./config.js";
import type { ResolvedUpstreamAuth } from "./auth-types.js";
import { upstreamAuthHeaders } from "./auth.js";
import { createClientCredentialsProvider } from "./oauth-provider.js";

/**
 * Tool metadata from an upstream MCP server.
 */
export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Resource metadata from an upstream MCP server.
 */
export interface UpstreamResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Prompt metadata from an upstream MCP server.
 */
export interface UpstreamPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * Discovered upstream server with its tools, resources, and prompts.
 */
export interface DiscoveredServer {
  name: string;
  tools: UpstreamTool[];
  resources: UpstreamResource[];
  prompts: UpstreamPrompt[];
  client: Client;
}

/**
 * Connect to an upstream MCP server and discover its tools.
 *
 * Supports stdio and streamable HTTP transports.
 * Default connection timeout is 30 seconds.
 */
export async function discoverServer(
  name: string,
  transportConfig: TransportConfig,
  connectTimeoutMs: number = 30_000,
  auth?: ResolvedUpstreamAuth
): Promise<DiscoveredServer> {
  let transport;

  if (transportConfig.type === "stdio") {
    transport = new StdioClientTransport({
      command: transportConfig.command,
      args: transportConfig.args,
      env: transportConfig.env,
      cwd: transportConfig.cwd,
    });
  } else if (transportConfig.type === "sse") {
    const url = new URL(transportConfig.url);
    const opts: {
      requestInit?: { headers: Record<string, string> };
      authProvider?: ReturnType<typeof createClientCredentialsProvider>;
    } = {};

    if (auth) {
      if (auth.type === "oauth") {
        opts.authProvider = createClientCredentialsProvider(
          auth.client_id,
          auth.client_secret,
          transportConfig.url
        );
      } else {
        opts.requestInit = { headers: upstreamAuthHeaders(auth) };
      }
    }

    transport = new StreamableHTTPClientTransport(url, opts);
  } else {
    throw new Error(`Unsupported transport type: ${(transportConfig as TransportConfig).type}`);
  }

  const client = new Client(
    { name: `MCPico-${name}`, version: "0.2.0" },
    { capabilities: {} }
  );

  // Connect with timeout
  await withTimeout(
    client.connect(transport),
    connectTimeoutMs,
    `Connection to "${name}" timed out after ${connectTimeoutMs}ms`
  );

  // Discover tools
  const toolsResult = await client.listTools();
  const tools: UpstreamTool[] = (toolsResult.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema as Record<string, unknown>) || {},
  }));

  // Discover resources (if supported)
  let resources: UpstreamResource[] = [];
  try {
    const resResult = await client.listResources();
    resources = (resResult.resources || []).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  } catch {
    // Resources may not be supported by this server
  }

  // Discover prompts (if supported)
  let prompts: UpstreamPrompt[] = [];
  try {
    const promptResult = await client.listPrompts();
    prompts = (promptResult.prompts || []).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: (p.arguments || []).map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required,
      })),
    }));
  } catch {
    // Prompts may not be supported by this server
  }

  return { name, tools, resources, prompts, client };
}

/**
 * Disconnect from an upstream server.
 */
export async function disconnectServer(server: DiscoveredServer): Promise<void> {
  await server.client.close();
}

/**
 * Race a promise against a timeout.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}
