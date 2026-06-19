import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TransportConfig } from "./config.js";

// Create mock instances for the Client class
const mockConnect = vi.fn();
const mockClose = vi.fn();
let listToolsResult = { tools: [] };
let listResourcesRejects = true;
let listResourcesResult = { resources: [] };
let listPromptsRejects = true;
let listPromptsResult = { prompts: [] };

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockConnect;
    close = mockClose;
    listTools = () => Promise.resolve(listToolsResult);
    listResources = () =>
      listResourcesRejects
        ? Promise.reject(new Error("Not supported"))
        : Promise.resolve(listResourcesResult);
    listPrompts = () =>
      listPromptsRejects
        ? Promise.reject(new Error("Not supported"))
        : Promise.resolve(listPromptsResult);
    callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "result" }],
    });
    readResource = vi.fn().mockResolvedValue({ contents: [] });
    getPrompt = vi.fn().mockResolvedValue({ messages: [] });
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(..._args: unknown[]) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(..._args: unknown[]) {}
  },
}));

import {
  discoverServer,
  disconnectServer,
  type DiscoveredServer,
} from "./discoverer.js";

describe("discoverServer", () => {
  const stdioTransport: TransportConfig = {
    type: "stdio",
    command: "npx",
    args: ["-y", "test-server"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listToolsResult = { tools: [] };
    listResourcesRejects = true;
    listResourcesResult = { resources: [] };
    listPromptsRejects = true;
    listPromptsResult = { prompts: [] };
  });

  it("connects to upstream and discovers tools", async () => {
    listToolsResult = {
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
        },
        {
          name: "write_file",
          description: "Write a file",
          inputSchema: { type: "object" },
        },
      ],
    };

    const server = await discoverServer("test-server", stdioTransport);

    expect(server.name).toBe("test-server");
    expect(server.tools).toHaveLength(2);
    expect(server.tools[0].name).toBe("read_file");
    expect(server.tools[0].description).toBe("Read a file");
    expect(server.tools[0].inputSchema).toEqual({ type: "object" });
    expect(mockConnect).toHaveBeenCalled();
  });

  it("handles tools without descriptions or schemas", async () => {
    listToolsResult = {
      tools: [{ name: "simple_tool" }],
    };

    const server = await discoverServer("test-server", stdioTransport);

    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe("simple_tool");
    expect(server.tools[0].inputSchema).toEqual({});
  });

  it("discovers resources when supported", async () => {
    listToolsResult = { tools: [] };
    listResourcesRejects = false;
    listResourcesResult = {
      resources: [
        {
          uri: "file:///tmp/test.txt",
          name: "test.txt",
          description: "A test file",
          mimeType: "text/plain",
        },
      ],
    };

    const server = await discoverServer("test-server", stdioTransport);

    expect(server.resources).toHaveLength(1);
    expect(server.resources[0].uri).toBe("file:///tmp/test.txt");
    expect(server.resources[0].name).toBe("test.txt");
    expect(server.resources[0].mimeType).toBe("text/plain");
  });

  it("discovers prompts when supported", async () => {
    listToolsResult = { tools: [] };
    listPromptsRejects = false;
    listPromptsResult = {
      prompts: [
        {
          name: "greeting",
          description: "Generate a greeting",
          arguments: [
            { name: "name", description: "Who to greet", required: true },
          ],
        },
      ],
    };

    const server = await discoverServer("test-server", stdioTransport);

    expect(server.prompts).toHaveLength(1);
    expect(server.prompts[0].name).toBe("greeting");
    expect(server.prompts[0].arguments).toHaveLength(1);
    expect(server.prompts[0].arguments![0].name).toBe("name");
    expect(server.prompts[0].arguments![0].required).toBe(true);
  });

  it("returns empty arrays when resources/prompts are not supported", async () => {
    listToolsResult = { tools: [] };
    listResourcesRejects = true;
    listPromptsRejects = true;

    const server = await discoverServer("test-server", stdioTransport);

    expect(server.resources).toEqual([]);
    expect(server.prompts).toEqual([]);
  });

  it("handles empty tools response gracefully", async () => {
    listToolsResult = {};

    const server = await discoverServer("test-server", stdioTransport);

    expect(server.tools).toEqual([]);
  });

  describe("sse transport", () => {
    const sseTransport: TransportConfig = {
      type: "sse",
      url: "https://mcp.example.com/api",
    };

    it("connects via SSE transport", async () => {
      listToolsResult = {
        tools: [{ name: "remote_tool", description: "Remote tool", inputSchema: {} }],
      };

      const server = await discoverServer("sse-server", sseTransport);

      expect(server.name).toBe("sse-server");
      expect(server.tools).toHaveLength(1);
      expect(server.tools[0].name).toBe("remote_tool");
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe("timeout", () => {
    it("rejects after timeout when connection hangs", async () => {
      // Simulate a connection that never resolves
      mockConnect.mockImplementationOnce(() => new Promise(() => {}));

      await expect(
        discoverServer("slow-server", stdioTransport, 100)
      ).rejects.toThrow("timed out");
    });

    it("succeeds when connection is fast enough", async () => {
      listToolsResult = { tools: [{ name: "fast", inputSchema: {} }] };

      const server = await discoverServer("fast-server", stdioTransport, 5000);

      expect(server.tools).toHaveLength(1);
    });
  });
});

describe("disconnectServer", () => {
  it("calls client.close()", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const server = {
      client: { close },
    } as unknown as DiscoveredServer;

    await disconnectServer(server);
    expect(close).toHaveBeenCalled();
  });
});
