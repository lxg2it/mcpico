/**
 * End-to-end tests for the HTTP (listen.type = "sse") transport.
 *
 * What this file is for: HTTP mode shipped broken and no test could see it.
 * The registered request handler drained the node request stream and passed a
 * raw string as the transport's parsed body, so EVERY request answered
 * 400 "Parse error: Invalid JSON-RPC message". Every unit test passed while the
 * published mode did not work at all, because the failure lived in the wiring
 * between two SDK types rather than in MCPico's own functions.
 *
 * So these tests drive the real binary: a config file, a spawned upstream over
 * stdio, and requests over a real socket. Nothing is mocked, on purpose — a
 * mock would have agreed with the bug.
 *
 * On the old transport code, test 1 fails (400 instead of 200) and the SDK
 * client in test 2 cannot connect at all.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const upstreamFixture = join(repoRoot, "test", "fixtures", "echo-upstream.mjs");

const START_TIMEOUT_MS = 30_000;

interface RunningPico {
  port: number;
  stderr: string;
  stop(): Promise<void>;
}

const running: ChildProcess[] = [];
const tempDirs: string[] = [];

/** Start the real CLI against a generated config and wait until it is listening. */
async function startPico(listen: Record<string, unknown>): Promise<RunningPico> {
  const dir = mkdtempSync(join(tmpdir(), "mcpico-http-"));
  tempDirs.push(dir);
  const configPath = join(dir, "mcpico.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      servers: [
        {
          name: "echo",
          transport: {
            type: "stdio",
            command: process.execPath,
            args: [upstreamFixture],
          },
        },
      ],
      listen: { type: "sse", host: "127.0.0.1", port: 0, ...listen },
    })
  );

  const child = spawn(tsxBin, ["src/index.ts", "--config", configPath], {
    cwd: repoRoot,
  });
  running.push(child);

  let stderr = "";
  const port = await new Promise<number>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(
        new Error(`MCPico did not start within ${START_TIMEOUT_MS}ms.\n${stderr}`)
      );
    }, START_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // The port is read from the process's own report, so port 0 in the config
      // is usable here and concurrent runs cannot collide on a fixed port.
      const match = stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolvePromise(Number(match[1]));
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectPromise(new Error(`MCPico exited early (code ${code}).\n${stderr}`));
    });
  });

  return {
    port,
    get stderr() {
      return stderr;
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise<void>((r) => setTimeout(r, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

afterAll(async () => {
  for (const child of running) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PROTOCOL_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/** Read a JSON-RPC payload from either a JSON body or an SSE stream. */
async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const payloads = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return JSON.parse(payloads[payloads.length - 1]);
}

async function post(
  port: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { ...PROTOCOL_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
}

function initializeRequest(id = 1): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcpico-http-test", version: "1.0.0" },
    },
  };
}

describe("HTTP transport", () => {
  it("answers sequential requests — initialize, then tools/list", async () => {
    const pico = await startPico({});
    try {
      const first = await post(pico.port, initializeRequest(1));
      expect(first.status).toBe(200);
      const initResult = await readJsonRpc(first);
      expect(initResult.result).toBeTruthy();

      // The second request is the one a shared server instance cannot serve:
      // under SDK v2 a reused instance fails the request after the first.
      const second = await post(pico.port, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
      expect(second.status).toBe(200);

      const listed = (await readJsonRpc(second)) as {
        result: { tools: { name: string }[] };
      };
      const names = listed.result.tools.map((tool) => tool.name);
      expect(names).toContain("echo");
      expect(names).toContain("help_echo");
    } finally {
      await pico.stop();
    }
  });

  it("runs an upstream tool end to end for a real MCP client", async () => {
    const pico = await startPico({});
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${pico.port}/mcp`)
    );
    const client = new Client({ name: "mcpico-http-test", version: "1.0.0" });
    try {
      await client.connect(transport);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "echo",
        "help_echo",
      ]);

      const call = await client.callTool({
        name: "echo",
        arguments: { subcommand: "echo", params: { text: "ping" } },
      });
      expect(JSON.stringify(call.content)).toContain("upstream-echo:ping");
    } finally {
      await client.close();
      await pico.stop();
    }
  });

  it("rejects requests without the configured bearer token", async () => {
    const pico = await startPico({
      auth: { type: "bearer", token: "test-token-abc" },
    });
    try {
      const unauthenticated = await post(pico.port, initializeRequest(1));
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("WWW-Authenticate")).toBe(
        'Bearer realm="MCPico"'
      );

      const wrongToken = await post(pico.port, initializeRequest(1), {
        Authorization: "Bearer not-the-token",
      });
      expect(wrongToken.status).toBe(401);

      const authorized = await post(pico.port, initializeRequest(1), {
        Authorization: "Bearer test-token-abc",
      });
      expect(authorized.status).toBe(200);
    } finally {
      await pico.stop();
    }
  });
});
