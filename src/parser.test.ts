import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";

describe("parseCommand", () => {
  describe("help / empty", () => {
    it("returns isHelp for empty string", () => {
      const result = parseCommand("");
      expect(result.isHelp).toBe(true);
      expect(result.subcommand).toBeNull();
      expect(result.args).toEqual({});
      expect(result.error).toBeNull();
    });

    it("returns isHelp for whitespace-only string", () => {
      const result = parseCommand("   ");
      expect(result.isHelp).toBe(true);
      expect(result.error).toBeNull();
    });

    it("returns isHelp for explicit 'help'", () => {
      const result = parseCommand("help");
      expect(result.isHelp).toBe(true);
      expect(result.subcommand).toBeNull();
      expect(result.args).toEqual({});
      expect(result.error).toBeNull();
    });

    it("returns isHelp for 'help' with extra whitespace", () => {
      const result = parseCommand("  help  ");
      expect(result.isHelp).toBe(true);
      expect(result.args).toEqual({});
    });
  });

  describe("bare subcommand (no args)", () => {
    it("parses a single-word subcommand", () => {
      const result = parseCommand("read_file");
      expect(result.subcommand).toBe("read_file");
      expect(result.args).toEqual({});
      expect(result.isHelp).toBe(false);
      expect(result.error).toBeNull();
    });

    it("handles subcommand with trailing whitespace", () => {
      const result = parseCommand("list_dir  ");
      expect(result.subcommand).toBe("list_dir");
      expect(result.args).toEqual({});
    });
  });

  describe("JSON args", () => {
    it("parses simple JSON object args", () => {
      const result = parseCommand('read_file {"path":"/etc/hosts"}');
      expect(result.subcommand).toBe("read_file");
      expect(result.args).toEqual({ path: "/etc/hosts" });
      expect(result.error).toBeNull();
    });

    it("parses multiple JSON args", () => {
      const result = parseCommand(
        'write_file {"path":"/tmp/out.txt","content":"hello","encoding":"utf-8"}'
      );
      expect(result.subcommand).toBe("write_file");
      expect(result.args).toEqual({
        path: "/tmp/out.txt",
        content: "hello",
        encoding: "utf-8",
      });
    });

    it("parses numeric and boolean values", () => {
      const result = parseCommand(
        'something {"count":42,"enabled":true,"ratio":3.14}'
      );
      expect(result.args).toEqual({
        count: 42,
        enabled: true,
        ratio: 3.14,
      });
    });

    it("parses nested JSON objects", () => {
      const result = parseCommand(
        'complex {"nested":{"key":"value"},"list":[1,2,3]}'
      );
      expect(result.args).toEqual({
        nested: { key: "value" },
        list: [1, 2, 3],
      });
    });

    it("parses null values", () => {
      const result = parseCommand('cmd {"key":null}');
      expect(result.args).toEqual({ key: null });
    });
  });

  describe("error handling", () => {
    it("returns error for malformed JSON", () => {
      const result = parseCommand('read_file {bad json}');
      expect(result.error).toContain("Could not parse arguments as JSON");
      expect(result.args).toEqual({});
      expect(result.isHelp).toBe(false);
    });

    it("returns error for JSON array instead of object", () => {
      const result = parseCommand('read_file ["a","b"]');
      expect(result.error).toContain("Arguments must be a JSON object");
      expect(result.args).toEqual({});
    });

    it("returns error for bare JSON primitive", () => {
      const result = parseCommand('read_file "just a string"');
      expect(result.error).toContain("Arguments must be a JSON object");
    });

    it("returns error for bare JSON number", () => {
      const result = parseCommand("read_file 42");
      expect(result.error).toContain("Arguments must be a JSON object");
    });

    it("returns error for incomplete JSON", () => {
      const result = parseCommand('read_file {"path":"/tmp');
      expect(result.error).toContain("Could not parse arguments as JSON");
    });
  });

  describe("edge cases", () => {
    it("handles subcommand with spaces in name (unusual but valid)", () => {
      // First space splits subcommand from args
      const result = parseCommand('my tool {"a":1}');
      expect(result.subcommand).toBe("my");
      expect(result.args).toEqual({});
      expect(result.error).toContain("Could not parse arguments");
    });

    it("handles subcommand followed by empty args", () => {
      const result = parseCommand("read_file ");
      expect(result.subcommand).toBe("read_file");
      expect(result.args).toEqual({});
      expect(result.error).toBeNull();
    });

    it("handles subcommand followed by spaces", () => {
      const result = parseCommand("read_file   ");
      expect(result.subcommand).toBe("read_file");
      expect(result.args).toEqual({});
    });

    it("handles JSON with leading/trailing whitespace in args", () => {
      const result = parseCommand(
        'read_file   {"path":"/tmp"}   '
      );
      expect(result.subcommand).toBe("read_file");
      expect(result.args).toEqual({ path: "/tmp" });
    });

    it("handles empty JSON object", () => {
      const result = parseCommand("cmd {}");
      expect(result.subcommand).toBe("cmd");
      expect(result.args).toEqual({});
      expect(result.error).toBeNull();
    });

    it("handles subcommand containing underscores", () => {
      const result = parseCommand(
        'filesystem_read_file {"path":"/tmp"}'
      );
      expect(result.subcommand).toBe("filesystem_read_file");
      expect(result.args).toEqual({ path: "/tmp" });
    });
  });
});
