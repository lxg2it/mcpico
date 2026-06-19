/**
 * Tests for auth utilities.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveEnvVars,
  resolveUpstreamAuth,
  resolveListenAuth,
  upstreamAuthHeaders,
  extractBearerToken,
  validateBearerToken,
  sendUnauthorized,
} from "./auth.js";
import type {
  BearerAuth,
  HeaderAuth,
  OAuthClientCredentials,
  ListenBearerAuth,
} from "./auth-types.js";

describe("resolveEnvVars", () => {
  beforeEach(() => {
    vi.stubEnv("TEST_TOKEN", "secret123");
    vi.stubEnv("API_KEY", "key-abc");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("replaces ${VAR} patterns with env values", () => {
    expect(resolveEnvVars("Bearer ${TEST_TOKEN}")).toBe("Bearer secret123");
  });

  it("replaces multiple env vars in one string", () => {
    expect(resolveEnvVars("${API_KEY}:${TEST_TOKEN}")).toBe("key-abc:secret123");
  });

  it("returns string unchanged if no env vars", () => {
    expect(resolveEnvVars("plain-value")).toBe("plain-value");
  });

  it("throws if referenced env var is not set", () => {
    expect(() => resolveEnvVars("${MISSING}")).toThrow(
      'Environment variable "MISSING" is not set'
    );
  });
});

describe("resolveUpstreamAuth", () => {
  beforeEach(() => {
    vi.stubEnv("BEARER_TOKEN", "bearer-token-123");
    vi.stubEnv("CUSTOM_KEY", "custom-key-456");
    vi.stubEnv("OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("OAUTH_TOKEN_URL", "https://auth.example.com/token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves bearer auth", () => {
    const auth: BearerAuth = { type: "bearer", token: "${BEARER_TOKEN}" };
    const resolved = resolveUpstreamAuth(auth);
    expect(resolved).toEqual({
      type: "bearer",
      token: "bearer-token-123",
    });
  });

  it("resolves header auth", () => {
    const auth: HeaderAuth = {
      type: "header",
      name: "X-API-Key",
      value: "${CUSTOM_KEY}",
    };
    const resolved = resolveUpstreamAuth(auth);
    expect(resolved).toEqual({
      type: "header",
      name: "X-API-Key",
      value: "custom-key-456",
    });
  });

  it("resolves oauth auth", () => {
    const auth: OAuthClientCredentials = {
      type: "oauth",
      grant_type: "client_credentials",
      client_id: "${OAUTH_CLIENT_ID}",
      client_secret: "${OAUTH_CLIENT_SECRET}",
      token_url: "${OAUTH_TOKEN_URL}",
    };
    const resolved = resolveUpstreamAuth(auth);
    expect(resolved).toEqual({
      type: "oauth",
      grant_type: "client_credentials",
      client_id: "client-id",
      client_secret: "client-secret",
      token_url: "https://auth.example.com/token",
    });
  });
});

describe("resolveListenAuth", () => {
  beforeEach(() => {
    vi.stubEnv("MCPICO_KEY", "mcplico-key-789");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves listen bearer auth", () => {
    const auth: ListenBearerAuth = { type: "bearer", token: "${MCPICO_KEY}" };
    const resolved = resolveListenAuth(auth);
    expect(resolved).toEqual({
      type: "bearer",
      token: "mcplico-key-789",
    });
  });
});

describe("upstreamAuthHeaders", () => {
  it("returns Authorization header for bearer auth", () => {
    const headers = upstreamAuthHeaders({
      type: "bearer",
      token: "my-token",
    });
    expect(headers).toEqual({ Authorization: "Bearer my-token" });
  });

  it("returns custom header for header auth", () => {
    const headers = upstreamAuthHeaders({
      type: "header",
      name: "X-API-Key",
      value: "key-123",
    });
    expect(headers).toEqual({ "X-API-Key": "key-123" });
  });

  it("returns empty object for oauth auth (handled by SDK)", () => {
    const headers = upstreamAuthHeaders({
      type: "oauth",
      grant_type: "client_credentials",
      client_id: "id",
      client_secret: "secret",
      token_url: "https://auth.example.com/token",
    });
    expect(headers).toEqual({});
  });
});

describe("extractBearerToken", () => {
  it("extracts token from Authorization header", () => {
    const req = { headers: { authorization: "Bearer my-token" } } as any;
    expect(extractBearerToken(req)).toBe("my-token");
  });

  it("is case-insensitive for Bearer prefix", () => {
    const req = { headers: { authorization: "bearer my-token" } } as any;
    expect(extractBearerToken(req)).toBe("my-token");
  });

  it("returns undefined if no Authorization header", () => {
    const req = { headers: {} } as any;
    expect(extractBearerToken(req)).toBeUndefined();
  });

  it("returns undefined if header is not Bearer", () => {
    const req = { headers: { authorization: "Basic dXNlcjpwYXNz" } } as any;
    expect(extractBearerToken(req)).toBeUndefined();
  });

  it("returns undefined if Authorization is empty string", () => {
    const req = { headers: { authorization: "" } } as any;
    expect(extractBearerToken(req)).toBeUndefined();
  });
});

describe("validateBearerToken", () => {
  it("returns true when tokens match", () => {
    expect(validateBearerToken("secret", "secret")).toBe(true);
  });

  it("returns false when tokens differ", () => {
    expect(validateBearerToken("wrong", "secret")).toBe(false);
  });

  it("returns false when provided token is undefined", () => {
    expect(validateBearerToken(undefined, "secret")).toBe(false);
  });

  it("returns false when tokens have different length", () => {
    expect(validateBearerToken("short", "longer-token")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(validateBearerToken("Secret", "secret")).toBe(false);
  });
});

describe("sendUnauthorized", () => {
  it("sends 401 with WWW-Authenticate header", () => {
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    sendUnauthorized(res);

    expect(res.writeHead).toHaveBeenCalledWith(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="mcplico"',
    });
    expect(res.end).toHaveBeenCalled();
  });
});
