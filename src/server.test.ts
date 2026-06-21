import { describe, it, expect, vi } from "vitest";
import { textResult, mergeGroups, handleToolCall, executeSubcommand, validateAllServerConfigs, buildGroupDescription, buildHelpDescription } from "./server.js";
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

describe("buildHelpDescription", () => {
  it("includes subcommand count", () => {
    const desc = buildHelpDescription(makeGroup({ groupName: "fs" }));
    expect(desc).toContain("fs subcommands");
    expect(desc).toContain("1 available");
  });

  it("references the help tool name", () => {
    const desc = buildHelpDescription(makeGroup({ groupName: "database" }));
    expect(desc).toContain("help_database");
  });

  it("directs to the execution tool", () => {
    const desc = buildHelpDescription(makeGroup({ groupName: "redis" }));
    expect(desc).toContain("'redis' tool");
  });

  it("shows correct count for multi-tool groups", () => {
    const group = makeGroup({
      groupName: "fs",
      tools: [makeTool({ name: "a" }), makeTool({ name: "b" }), makeTool({ name: "c" })],
    });
    const desc = buildHelpDescription(group);
    expect(desc).toContain("3 available");
  });
});

describe("buildGroupDescription", () => {
  it("includes group name and subcommand format", () => {
    const desc = buildGroupDescription(makeGroup({ groupName: "filesystem" }));
    expect(desc).toContain("filesystem operations");
    expect(desc).toContain("filesystem_<operation>");
  });

  it("shows correct tool count", () => {
    const desc = buildGroupDescription(makeGroup());
    expect(desc).toContain("(1 total)");
  });

  it("lists available subcommands for multiple tools", () => {
    const group = makeGroup({
      groupName: "db",
      tools: [makeTool({ name: "db_query" }), makeTool({ name: "db_insert" })],
    });
    const desc = buildGroupDescription(group);
    expect(desc).toContain("query, insert");
    expect(desc).toContain("(2 total)");
  });

  it("truncates long subcommand lists with ellipsis", () => {
    const group = makeGroup({
      groupName: "fs",
      tools: [
        makeTool({ name: "fs_read" }),
        makeTool({ name: "fs_write" }),
        makeTool({ name: "fs_list" }),
        makeTool({ name: "fs_delete" }),
        makeTool({ name: "fs_search" }),
        makeTool({ name: "fs_copy" }),
      ],
    });
    const desc = buildGroupDescription(group);
    expect(desc).toContain("...");
    expect(desc).toContain("(6 total)");
  });

  it("references the help tool", () => {
    const desc = buildGroupDescription(makeGroup({ groupName: "slack" }));
    expect(desc).toContain("help_slack");
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
      expect(result.content[0].text).toContain("Available in");
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

describe("executeSubcommand", () => {
  const servers = [makeServer()];
  const group = makeGroup();

  it("forwards to upstream for valid subcommand", async () => {
    const forwardFn = vi.fn().mockResolvedValue(makeTextResult("ok"));
    const result = await executeSubcommand("test_tool", { key: "val" }, group, servers, forwardFn);
    expect(forwardFn).toHaveBeenCalledWith(servers[0], "test_tool", { key: "val" });
    expect(result).toEqual(makeTextResult("ok"));
  });

  it("returns error for unknown subcommand", async () => {
    const result = await executeSubcommand("nonexistent", {}, group, servers);
    expect(result.content?.[0]).toBeDefined();
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain('Unknown subcommand: "nonexistent"');
      expect(result.content[0].text).toContain("help_test_group");
    }
  });

  it("returns internal error when server not found", async () => {
    const orphanGroup = makeGroup({ tools: [makeTool({ name: "orphan" })] });
    const result = await executeSubcommand("orphan", {}, orphanGroup, []);
    expect(result.content?.[0]).toBeDefined();
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain("Internal error");
    }
  });

  it("handles forward errors", async () => {
    const forwardFn = vi.fn().mockRejectedValue(new Error("crash"));
    const result = await executeSubcommand("test_tool", {}, group, servers, forwardFn);
    if (result.content?.[0] && "text" in result.content[0]) {
      expect(result.content[0].text).toContain("Error calling");
      expect(result.content[0].text).toContain("crash");
    }
  });

  it("finds correct server among multiple", async () => {
    const serverA = makeServer({ name: "a", tools: [makeTool({ name: "tool_a" })] });
    const serverB = makeServer({ name: "b", tools: [makeTool({ name: "tool_b" })] });
    const multiGroup = makeGroup({
      groupName: "multi",
      tools: [makeTool({ name: "tool_a" }), makeTool({ name: "tool_b" })],
    });
    const forwardFn = vi.fn().mockResolvedValue(makeTextResult("ok"));
    await executeSubcommand("tool_b", {}, multiGroup, [serverA, serverB], forwardFn);
    expect(forwardFn).toHaveBeenCalledWith(serverB, "tool_b", {});
  });
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
