import { describe, it, expect } from "vitest";
import { validateServerConfig, type ServerConfig } from "./config.js";

describe("validateServerConfig", () => {
  describe("server name", () => {
    it("returns error for missing name", () => {
      const server = { name: "", transport: { type: "stdio" as const, command: "echo" } } as ServerConfig;
      expect(validateServerConfig(server)).toContain('"name"');
    });

    it("returns null for valid stdio config", () => {
      const server: ServerConfig = {
        name: "test-server",
        transport: { type: "stdio", command: "echo" },
      };
      expect(validateServerConfig(server)).toBeNull();
    });
  });

  describe("stdio transport", () => {
    it("requires command", () => {
      const server: ServerConfig = {
        name: "test",
        transport: { type: "stdio", command: "" },
      };
      expect(validateServerConfig(server)).toContain('"command"');
    });

    it("accepts stdio with optional fields", () => {
      const server: ServerConfig = {
        name: "test",
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "server"],
          env: { DEBUG: "1" },
          cwd: "/tmp",
        },
      };
      expect(validateServerConfig(server)).toBeNull();
    });
  });

  describe("sse transport", () => {
    it("requires url", () => {
      const server: ServerConfig = {
        name: "test",
        transport: { type: "sse", url: "" },
      };
      expect(validateServerConfig(server)).toContain('"url"');
    });

    it("validates URL format", () => {
      const server: ServerConfig = {
        name: "test",
        transport: { type: "sse", url: "not-a-valid-url" },
      };
      expect(validateServerConfig(server)).toContain("not a valid URL");
    });

    it("accepts valid HTTP URL", () => {
      const server: ServerConfig = {
        name: "test",
        transport: { type: "sse", url: "http://localhost:8080/mcp" },
      };
      expect(validateServerConfig(server)).toBeNull();
    });

    it("accepts valid HTTPS URL", () => {
      const server: ServerConfig = {
        name: "test",
        transport: { type: "sse", url: "https://mcp.example.com/api" },
      };
      expect(validateServerConfig(server)).toBeNull();
    });
  });

  describe("unknown transport", () => {
    it("returns error for unknown transport type", () => {
      const server = {
        name: "test",
        transport: { type: "websocket" },
      } as unknown as ServerConfig;
      const err = validateServerConfig(server);
      expect(err).toContain("unknown transport type");
      expect(err).toContain("websocket");
    });
  });

  describe("missing transport", () => {
    it("returns error for missing transport", () => {
      const server = { name: "test" } as ServerConfig;
      expect(validateServerConfig(server)).toContain('"transport"');
    });
  });
});
