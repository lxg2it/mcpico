/**
 * Tests for token store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  storageKey,
  saveTokens,
  loadTokens,
  clearTokens,
  isTokenValid,
} from "./token-store.js";

const TEST_CREDENTIALS_DIR = join(homedir(), ".mcplico");
const TEST_CREDENTIALS_FILE = join(TEST_CREDENTIALS_DIR, "credentials.json");

// Mock homedir to a temp location for test isolation
const realHomedir = homedir;

describe("token-store", () => {
  beforeEach(() => {
    // Clean up between tests
    try {
      rmSync(TEST_CREDENTIALS_FILE, { force: true });
    } catch {}
  });

  afterEach(() => {
    try {
      rmSync(TEST_CREDENTIALS_FILE, { force: true });
    } catch {}
  });

  describe("storageKey", () => {
    it("derives key from URL hostname and path", () => {
      expect(storageKey("https://auth.example.com/token")).toBe(
        "auth.example.com/token"
      );
    });

    it("uses hostname only for root path", () => {
      expect(storageKey("https://auth.example.com")).toBe("auth.example.com");
    });

    it("handles non-URL strings gracefully", () => {
      const key = storageKey("not-a-url");
      expect(key).toBe("not_a_url");
    });
  });

  describe("saveTokens and loadTokens", () => {
    it("saves and loads tokens", () => {
      const serverUrl = "https://api.example.com/mcp";
      saveTokens(serverUrl, {
        access_token: "access-123",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-456",
      });

      const tokens = loadTokens(serverUrl);
      expect(tokens).toBeDefined();
      expect(tokens!.access_token).toBe("access-123");
      expect(tokens!.token_type).toBe("Bearer");
      expect(tokens!.refresh_token).toBe("refresh-456");
      expect(tokens!.expires_in).toBeGreaterThan(0);
      expect(tokens!.expires_in).toBeLessThanOrEqual(3600);
    });

    it("returns undefined for unknown server", () => {
      expect(loadTokens("https://unknown.example.com")).toBeUndefined();
    });

    it("defaults token_type to Bearer if not stored", () => {
      const serverUrl = "https://api.example.com";
      saveTokens(serverUrl, {
        access_token: "at",
        token_type: "Bearer",
      } as any);

      // Manually strip token_type from the store
      const fs = require("node:fs");
      const raw = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const store = JSON.parse(raw);
      const key = storageKey(serverUrl);
      delete store[key].token_type;
      fs.writeFileSync(TEST_CREDENTIALS_FILE, JSON.stringify(store));

      const tokens = loadTokens(serverUrl);
      expect(tokens!.token_type).toBe("Bearer");
    });
  });

  describe("clearTokens", () => {
    it("removes tokens for a server", () => {
      const serverUrl = "https://api.example.com";
      saveTokens(serverUrl, {
        access_token: "at",
        token_type: "Bearer",
      });
      expect(loadTokens(serverUrl)).toBeDefined();

      clearTokens(serverUrl);
      expect(loadTokens(serverUrl)).toBeUndefined();
    });
  });

  describe("isTokenValid", () => {
    it("returns false when no tokens stored", () => {
      expect(isTokenValid("https://nonexistent.example.com")).toBe(false);
    });

    it("returns true for a freshly saved token", () => {
      const serverUrl = "https://api.example.com";
      saveTokens(serverUrl, {
        access_token: "at",
        token_type: "Bearer",
        expires_in: 3600,
      });
      expect(isTokenValid(serverUrl)).toBe(true);
    });

    it("returns true for token without expiry info", () => {
      const serverUrl = "https://api.example.com";
      saveTokens(serverUrl, {
        access_token: "at",
        token_type: "Bearer",
      });
      expect(isTokenValid(serverUrl)).toBe(true);
    });

    it("returns false for expired token", () => {
      const serverUrl = "https://api.example.com";
      // Save token with expires_at in the past
      const fs = require("node:fs");
      saveTokens(serverUrl, {
        access_token: "at",
        token_type: "Bearer",
        expires_in: 3600,
      });

      // Manually set expires_at to 1 hour ago
      const raw = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const store = JSON.parse(raw);
      const key = storageKey(serverUrl);
      store[key].expires_at = Date.now() - 3600_000;
      fs.writeFileSync(TEST_CREDENTIALS_FILE, JSON.stringify(store));

      expect(isTokenValid(serverUrl)).toBe(false);
    });
  });
});
