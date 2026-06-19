import { describe, it, expect, vi } from "vitest";
import { textResult, mergeGroups, handleToolCall, validateAllServerConfigs, buildGroupDescription } from "./server.js";
import type { ToolGroup } from "./grouper.js";
import type { DiscoveredServer, UpstreamTool } from "./discoverer.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function makeTool(overrides: Partial<UpstreamTool> = {}): UpstreamTool {
  return {
    name: "test_tool",
    description: "A test tool",
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

function makeGroup(overrides: Partial<ToolGroup> = {}): ToolGroup {
  return {
    groupName: "test_group",
    serverName: "test-server",
    tools: [makeTool()],
    ...overrides,
  };
}

function makeServer(overrides: Partial<DiscoveredServer> = {}): DiscoveredServer {
  return {
    name: "test-server",
    tools: [makeTool()],
    resources: [],
    prompts: [],
    client: {} as any,
    ...overrides,
  };
}

function makeTextResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

describe("textResult", () => {
  it("wraps text in content array", () => {
    const result = textResult("hello");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("handles empty string", () => {
    const result = textResult("");
    expect(result).toEqual({
      content: [{ type: "text", text: "" }],
    });
  });
});

describe("mergeGroups", () => {
  it("returns empty map for empty input", () => {
    const result = mergeGroups([]);
    expect(result.size).toBe(0);
  });

  it("preserves single group", () => {
    const group = makeGroup({ groupName: "filesystem" });
    const result = mergeGroups([group]);
    expect(result.size).toBe(1);
    const entry = result.get("filesystem")!;
    expect(entry.groupName).toBe("filesystem");
    expect(entry.tools).toHaveLength(1);
  });

  it("keeps different groups separate", () => {
    const groups = [
      makeGroup({ groupName: "filesystem" }),
      makeGroup({ groupName: "database" }),
    ];
    const result = mergeGroups(groups);
    expect(result.size).toBe(2);
    expect(result.has("filesystem")).toBe(true);
    expect(result.has("database")).toBe(true);
  });

  it("merges groups with same name across servers", () => {
    const groups = [
      makeGroup({
        groupName: "filesystem",
        serverName: "server-a",
        tools: [makeTool({ name: "read" })],
      }),
      makeGroup({
        groupName: "filesystem",
        serverName: "server-b",
        tools: [makeTool({ name: "write" })],
      }),
    ];
    const result = mergeGroups(groups);
    expect(result.size).toBe(1);
    const merged = result.get("filesystem")!;
    expect(merged.tools).toHaveLength(2);
    expect(merged.tools.map((t) => t.name)).toEqual(["read", "write"]);
    expect(merged.serverName).toContain("server-a");
    expect(merged.serverName).toContain("server-b");
  });

  it("does not duplicate server name when already present", () => {
    const groups = [
      makeGroup({
        groupName: "filesystem",
        serverName: "server-a + server-b",
        tools: [makeTool({ name: "read" })],
      }),
      makeGroup({
        groupName: "filesystem",
        serverName: "server-b",
        tools: [makeTool({ name: "write" })],
      }),
    ];
    const result = mergeGroups(groups);
    const merged = result.get("filesystem")!;
    // server-b is already in "server-a + server-b", should not be added again
    expect(merged.serverName).toBe("server-a + server-b");
  });
});

describe("validateAllServerConfigs", () => {
  it("returns empty for valid configs", () => {
    const errors = validateAllServerConfigs([
      { name: "server-a", transport: { type: "stdio" as const, command: "echo" } },
    ]);
    expect(errors).toEqual([]);
  });

  it("returns errors for invalid configs", () => {
    const errors = validateAllServerConfigs([
      { name: "", transport: { type: "stdio" as const, command: "" } },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("validates multiple configs and collects all errors", () => {
    const errors = validateAllServerConfigs([
      { name: "", transport: { type: "stdio" as const, command: "" } },
      { name: "missing-transport" } as any,
    ]);
    expect(errors.length).toBe(2);
  });

  it("handles empty servers array", () => {
    const errors = validateAllServerConfigs([]);
    expect(errors).toEqual([]);
  });
});

describe("buildGroupDescription", () => {
  it("includes group name", () => {
    const desc = buildGroupDescription(makeGroup({ groupName: "filesystem" }));
    expect(desc).toContain("MCPico filesystem");
  });

  it("shows singular for 1 tool", () => {
    const desc = buildGroupDescription(makeGroup());
    expect(desc).toContain("1 tool");
  });

  it("shows plural for multiple tools", () => {
    const group = makeGroup({
      tools: [makeTool({ name: "a" }), makeTool({ name: "b" })],
    });
    const desc = buildGroupDescription(group);
    expect(desc).toContain("2 tools");
  });

  it("includes server name", () => {
    const desc = buildGroupDescription(makeGroup({ serverName: "my-upstream" }));
    expect(desc).toContain("Source: my-upstream");
  });

  it("includes usage hints", () => {
    const desc = buildGroupDescription(makeGroup());
    expect(desc).toContain("Use 'help'");
    expect(desc).toContain("<subcommand>");
  });
});

describe("handleToolCall", () => {
  const servers = [makeServer()];
  const group = makeGroup();
  const helpText = "Help text here";

  it("returns help for 'help' command", async () => {
    const result = await handleToolCall("help", group, servers, helpText);
    expect(result).toEqual(makeTextResult(helpText));
  });

  it("returns help for empty command", async () => {
    const result = await handleToolCall("", group, servers, helpText);
    expect(result).toEqual(makeTextResult(helpText));
  });

  it("returns help for whitespace command", async () => {
    const result = await handleToolCall("  ", group, servers, helpText);
    expect(result).toEqual(makeTextResult(helpText));
  });

  it("returns parse error for invalid JSON args", async () => {
    const result = await handleToolCall(
      "test_tool {bad json}",
      group,
      servers,
      helpText
    );
    expect(result.content?.[0]).toBeDefined();
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain("Could not parse arguments as JSON");
    }
  });

  it("returns error for unknown subcommand", async () => {
    const result = await handleToolCall(
      "nonexistent",
      group,
      servers,
      helpText
    );
    expect(result.content?.[0]).toBeDefined();
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain('Unknown subcommand: "nonexistent"');
      expect(result.content[0].text).toContain("test_tool");
    }
  });

  it("returns internal error when server not found for valid tool", async () => {
    // Tool exists in group but no server has it
    const orphanTool = makeTool({ name: "orphan_tool" });
    const orphanGroup = makeGroup({ tools: [orphanTool] });
    const emptyServers: DiscoveredServer[] = [];

    const result = await handleToolCall(
      "orphan_tool",
      orphanGroup,
      emptyServers,
      helpText
    );
    expect(result.content?.[0]).toBeDefined();
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain("Internal error");
    }
  });

  it("dispatches to forwardFn for valid tool", async () => {
    const forwardFn = vi.fn().mockResolvedValue(makeTextResult("forwarded!"));

    const result = await handleToolCall(
      "test_tool",
      group,
      servers,
      helpText,
      forwardFn
    );

    expect(forwardFn).toHaveBeenCalledTimes(1);
    expect(forwardFn).toHaveBeenCalledWith(servers[0], "test_tool", {});
    expect(result).toEqual(makeTextResult("forwarded!"));
  });

  it("passes parsed args to forwardFn", async () => {
    const forwardFn = vi.fn().mockResolvedValue(makeTextResult("ok"));

    await handleToolCall(
      'test_tool {"key":"value","count":42}',
      group,
      servers,
      helpText,
      forwardFn
    );

    expect(forwardFn).toHaveBeenCalledWith(servers[0], "test_tool", {
      key: "value",
      count: 42,
    });
  });

  it("returns error when forwardFn throws", async () => {
    const forwardFn = vi.fn().mockRejectedValue(new Error("Connection lost"));

    const result = await handleToolCall(
      "test_tool",
      group,
      servers,
      helpText,
      forwardFn
    );

    expect(result.content?.[0]).toBeDefined();
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain('Error calling "test_tool"');
      expect(result.content[0].text).toContain("Connection lost");
    }
  });

  it("finds correct server when multiple servers exist", async () => {
    const serverA = makeServer({
      name: "server-a",
      tools: [makeTool({ name: "tool_a" })],
    });
    const serverB = makeServer({
      name: "server-b",
      tools: [makeTool({ name: "tool_b" })],
    });
    const multiGroup = makeGroup({
      tools: [makeTool({ name: "tool_a" }), makeTool({ name: "tool_b" })],
    });
    const forwardFn = vi.fn().mockResolvedValue(makeTextResult("ok"));

    await handleToolCall(
      "tool_b",
      multiGroup,
      [serverA, serverB],
      helpText,
      forwardFn
    );

    expect(forwardFn).toHaveBeenCalledWith(serverB, "tool_b", {});
  });
});
