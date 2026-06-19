#!/usr/bin/env node

/**
 * MCPico — MCP proxy that bundles flat tool lists into hierarchical subcommand groups.
 *
 * Usage:
 *   mcpico [--config <path>]
 *
 * Configuration is read from mcpico.json in the current directory by default.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "./server.js";
import type { MCPicoConfig } from "./config.js";

async function main(): Promise<void> {
  // Parse CLI args
  const args = process.argv.slice(2);
  let configPath = "mcpico.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" || args[i] === "-c") {
      configPath = args[i + 1] || configPath;
      i++;
    } else if (args[i] === "--version" || args[i] === "-v") {
      console.log("MCPico v0.2.0");
      process.exit(0);
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
MCPico — MCP proxy that bundles flat tool lists into hierarchical subcommand groups.

Usage:
  mcpico [--config <path>]

Options:
  --config, -c <path>    Path to config file (default: mcpico.json)
  --version, -v          Show version
  --help, -h             Show this help

Config file format (mcpico.json):
  {
    "servers": [
      {
        "name": "filesystem",
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
        }
      }
    ],
    "separator": "_",
    "groups": {}
  }
`);
      process.exit(0);
    }
  }

  // Resolve config path
  const resolvedPath = resolve(configPath);
  let config: MCPicoConfig;

  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    config = JSON.parse(raw) as MCPicoConfig;
  } catch (err) {
    console.error(
      `Error reading config file "${resolvedPath}":`,
      (err as Error).message
    );
    process.exit(1);
  }

  // Validate
  if (!config.servers || !Array.isArray(config.servers) || config.servers.length === 0) {
    console.error('Config error: "servers" must be a non-empty array');
    process.exit(1);
  }

  for (const server of config.servers) {
    if (!server.name || !server.transport) {
      console.error(
        'Config error: each server must have a "name" and "transport"'
      );
      process.exit(1);
    }
    if (
      server.transport.type === "stdio" &&
      !server.transport.command
    ) {
      console.error(
        `Config error: server "${server.name}" missing transport.command`
      );
      process.exit(1);
    }
  }

  await startServer(config);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
