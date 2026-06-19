import { describe, it, expect, vi } from "vitest";
import { forwardToolCall } from "./proxy.js";
import type { DiscoveredServer } from "./discoverer.js";

describe("forwardToolCall", () => {
  it("calls client.callTool with the correct tool name and arguments", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "success" }],
    });

    const server = {
      client: { callTool },
    } as unknown as DiscoveredServer;

    const result = await forwardToolCall(server, "read_file", {
      path: "/tmp/test.txt",
    });

    expect(callTool).toHaveBeenCalledWith({
      name: "read_file",
      arguments: { path: "/tmp/test.txt" },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "success" }],
    });
  });

  it("passes through errors from the upstream server", async () => {
    const callTool = vi
      .fn()
      .mockRejectedValue(new Error("Upstream connection failed"));

    const server = {
      client: { callTool },
    } as unknown as DiscoveredServer;

    await expect(
      forwardToolCall(server, "bad_tool", {})
    ).rejects.toThrow("Upstream connection failed");
  });

  it("handles empty arguments", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const server = {
      client: { callTool },
    } as unknown as DiscoveredServer;

    await forwardToolCall(server, "status", {});
    expect(callTool).toHaveBeenCalledWith({
      name: "status",
      arguments: {},
    });
  });

  it("handles nested arguments", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
    });

    const server = {
      client: { callTool },
    } as unknown as DiscoveredServer;

    await forwardToolCall(server, "complex", {
      nested: { key: "value" },
      array: [1, 2, 3],
    });

    expect(callTool).toHaveBeenCalledWith({
      name: "complex",
      arguments: { nested: { key: "value" }, array: [1, 2, 3] },
    });
  });
});
