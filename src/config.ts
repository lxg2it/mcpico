/**
 * Transport configuration for connecting to an upstream MCP server.
 */
export type TransportConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type: "sse";
      /** Full URL to the MCP Streamable HTTP endpoint (e.g. "https://mcp.example.com/mcp") */
      url: string;
    };

/**
 * Server configuration entry.
 */
export interface ServerConfig {
  /** Friendly name used as the tool group namespace */
  name: string;
  /** Transport to connect to this upstream server */
  transport: TransportConfig;
  /** Connection timeout in milliseconds (default: 30000) */
  connectTimeoutMs?: number;
}

/**
 * Tool grouping override — map group names to explicit tool lists.
 */
export interface GroupOverrides {
  [groupName: string]: string[];
}

/**
 * Full MCPico configuration.
 */
export interface MCPicoConfig {
  /** Upstream MCP servers to proxy */
  servers: ServerConfig[];
  /** Separator used for prefix-based tool grouping (default: "_") */
  separator?: string;
  /** Explicit group overrides — tools not listed here are auto-grouped */
  groups?: GroupOverrides;
}

/**
 * Validate server config and return a user-friendly error message, or null if valid.
 */
export function validateServerConfig(server: ServerConfig): string | null {
  if (!server.name || typeof server.name !== "string") {
    return 'Each server must have a non-empty "name" (string)';
  }
  if (!server.transport) {
    return `Server "${server.name}": missing "transport"`;
  }
  if (server.transport.type === "stdio") {
    if (!server.transport.command) {
      return `Server "${server.name}": stdio transport requires "command"`;
    }
  } else if (server.transport.type === "sse") {
    if (!server.transport.url) {
      return `Server "${server.name}": sse transport requires "url"`;
    }
    try {
      new URL(server.transport.url);
    } catch {
      return `Server "${server.name}": sse transport "url" is not a valid URL: "${server.transport.url}"`;
    }
  } else {
    return `Server "${server.name}": unknown transport type "${(server.transport as Record<string, string>).type}". Supported: stdio, sse`;
  }
  return null;
}
