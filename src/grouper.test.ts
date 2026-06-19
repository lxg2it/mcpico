import { describe, it, expect } from "vitest";
import { groupTools, type ToolGroup } from "./grouper.js";
import type { UpstreamTool } from "./discoverer.js";

function makeTool(name: string, description?: string): UpstreamTool {
  return { name, description, inputSchema: {} };
}

function groupNames(groups: ToolGroup[]): string[] {
  return groups.map((g) => g.groupName);
}

function toolNames(group: ToolGroup): string[] {
  return group.tools.map((t) => t.name);
}

describe("groupTools", () => {
  describe("prefix-based grouping", () => {
    it("groups tools by underscore prefix", () => {
      const tools = [
        makeTool("filesystem_read_file"),
        makeTool("filesystem_write_file"),
        makeTool("filesystem_list_dir"),
      ];
      const groups = groupTools("test-server", tools);

      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("filesystem");
      expect(toolNames(groups[0])).toEqual([
        "filesystem_read_file",
        "filesystem_write_file",
        "filesystem_list_dir",
      ]);
    });

    it("groups tools with different prefixes into separate groups", () => {
      const tools = [
        makeTool("fs_read"),
        makeTool("fs_write"),
        makeTool("db_query"),
        makeTool("db_insert"),
      ];
      const groups = groupTools("test-server", tools);

      expect(groups).toHaveLength(2);
      expect(groupNames(groups)).toEqual(
        expect.arrayContaining(["fs", "db"])
      );
    });

    it("uses custom separator", () => {
      const tools = [
        makeTool("github.create_issue"),
        makeTool("github.list_repos"),
      ];
      const groups = groupTools("test-server", tools, ".");

      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("github");
    });

    it("puts tools without prefix into server-named group", () => {
      const tools = [
        makeTool("read"),
        makeTool("write"),
        makeTool("filesystem_list"),
      ];
      const groups = groupTools("my-server", tools);

      const defaultGroup = groups.find(
        (g) => g.groupName === "my-server"
      );
      expect(defaultGroup).toBeDefined();
      expect(toolNames(defaultGroup!)).toEqual(["read", "write"]);
    });

    it("handles mixed prefixed and unprefixed tools", () => {
      const tools = [
        makeTool("help"),
        makeTool("status"),
        makeTool("fs_read"),
      ];
      const groups = groupTools("test-server", tools);

      expect(groups).toHaveLength(2);
      const fsGroup = groups.find((g) => g.groupName === "fs");
      const defaultGroup = groups.find(
        (g) => g.groupName === "test-server"
      );
      expect(fsGroup).toBeDefined();
      expect(defaultGroup).toBeDefined();
      expect(toolNames(defaultGroup!)).toEqual(["help", "status"]);
    });
  });

  describe("explicit overrides", () => {
    it("applies group overrides", () => {
      const tools = [
        makeTool("custom_tool_a"),
        makeTool("custom_tool_b"),
      ];
      const groups = groupTools("test-server", tools, "_", {
        my_group: ["custom_tool_a", "custom_tool_b"],
      });

      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("my_group");
      expect(toolNames(groups[0])).toEqual([
        "custom_tool_a",
        "custom_tool_b",
      ]);
    });

    it("mixes overrides with prefix-based grouping", () => {
      const tools = [
        makeTool("special_tool"),
        makeTool("fs_read"),
        makeTool("fs_write"),
      ];
      const groups = groupTools("test-server", tools, "_", {
        special: ["special_tool"],
      });

      expect(groups).toHaveLength(2);
      const specialGroup = groups.find((g) => g.groupName === "special");
      const fsGroup = groups.find((g) => g.groupName === "fs");
      expect(specialGroup).toBeDefined();
      expect(fsGroup).toBeDefined();
      expect(toolNames(specialGroup!)).toEqual(["special_tool"]);
    });

    it("overridden tools are removed from prefix groups", () => {
      // "special_fs_read" would normally go in "special" prefix group,
      // but override puts it in "custom" instead
      const tools = [
        makeTool("special_fs_read"),
        makeTool("special_fs_write"),
      ];
      const groups = groupTools("test-server", tools, "_", {
        custom: ["special_fs_read"],
      });

      const customGroup = groups.find((g) => g.groupName === "custom");
      const specialGroup = groups.find(
        (g) => g.groupName === "special"
      );
      expect(customGroup).toBeDefined();
      expect(specialGroup).toBeDefined();
      expect(toolNames(customGroup!)).toEqual(["special_fs_read"]);
      expect(toolNames(specialGroup!)).toEqual(["special_fs_write"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for no tools", () => {
      const groups = groupTools("test-server", []);
      expect(groups).toEqual([]);
    });

    it("handles tools with separator at start (no prefix)", () => {
      const tools = [makeTool("_read")];
      const groups = groupTools("test-server", tools);
      // Prefix index is 0, which is <= 0, so no prefix
      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("test-server");
    });

    it("handles tools with separator at end (no suffix)", () => {
      const tools = [makeTool("read_")];
      const groups = groupTools("test-server", tools);
      // Separator index is at last char, so no valid suffix
      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("test-server");
    });

    it("sets serverName on all groups", () => {
      const tools = [
        makeTool("fs_read"),
        makeTool("unprefixed"),
      ];
      const groups = groupTools("my-server", tools);
      for (const g of groups) {
        expect(g.serverName).toBe("my-server");
      }
    });

    it("handles multiple separators in tool name (takes first)", () => {
      const tools = [makeTool("prefix_sub_sub")];
      const groups = groupTools("test-server", tools);
      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("prefix");
    });

    it("groups single-tool prefix correctly", () => {
      const tools = [makeTool("solo_tool")];
      const groups = groupTools("test-server", tools);
      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe("solo");
      expect(groups[0].tools).toHaveLength(1);
    });
  });
});
