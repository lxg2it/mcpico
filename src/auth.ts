/**
 * Auth utilities: env var resolution, header generation, listen token validation.
 */
import type { IncomingMessage } from "node:http";
import type {
  UpstreamAuth,
  ListenAuth,
  ResolvedUpstreamAuth,
  ResolvedListenAuth,
  BearerAuth,
  HeaderAuth,
  OAuthClientCredentials,
} from "./auth-types.js";

// ── Env var interpolation ──

/**
 * Replace ${VAR} patterns with process.env values.
 * Throws if a referenced env var is not set.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(
        `Environment variable "${varName}" is not set. ` +
          `Referenced in auth config. Set it or remove the auth block.`
      );
    }
    return envValue;
  });
}

// ── Auth resolution ──

/**
 * Resolve an UpstreamAuth config to a ResolvedUpstreamAuth with env vars interpolated.
 */
export function resolveUpstreamAuth(
  auth: UpstreamAuth
): ResolvedUpstreamAuth {
  switch (auth.type) {
    case "bearer":
      return {
        type: "bearer",
        token: resolveEnvVars(auth.token),
      } as ResolvedUpstreamAuth;

    case "header":
      return {
        type: "header",
        name: resolveEnvVars(auth.name),
        value: resolveEnvVars(auth.value),
      } as ResolvedUpstreamAuth;

    case "oauth":
      // OAuth credentials are resolved at request time by the provider
      return {
        type: "oauth",
        grant_type: auth.grant_type,
        client_id: resolveEnvVars(auth.client_id),
        client_secret: resolveEnvVars(auth.client_secret),
        token_url: resolveEnvVars(auth.token_url),
        scopes: auth.scopes,
        authorization_server_url: auth.authorization_server_url
          ? resolveEnvVars(auth.authorization_server_url)
          : undefined,
      } as ResolvedUpstreamAuth;
  }
}

/**
 * Resolve a ListenAuth config to ResolvedListenAuth.
 */
export function resolveListenAuth(
  auth: ListenAuth
): ResolvedListenAuth {
  return {
    type: "bearer",
    token: resolveEnvVars(auth.token),
  };
}

// ── Header generation for upstream requests ──

/**
 * Generate HTTP headers from a resolved upstream auth config.
 * For bearer/header types, returns headers to attach to requests.
 * For OAuth, returns empty — the SDK authProvider handles it.
 */
export function upstreamAuthHeaders(
  auth: ResolvedUpstreamAuth
): Record<string, string> {
  if (auth.type === "bearer") {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === "header") {
    return { [auth.name]: auth.value };
  }
  // OAuth is handled by the MCP SDK's authProvider — no static headers
  return {};
}

// ── Listen endpoint auth middleware ──

/**
 * Extract bearer token from an Authorization header.
 * Returns undefined if no Bearer token found.
 */
export function extractBearerTokenFromHeader(
  header: string | null | undefined
): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : undefined;
}

/**
 * Extract bearer token from an incoming node request.
 * Returns undefined if no Bearer token found.
 */
export function extractBearerToken(req: IncomingMessage): string | undefined {
  return extractBearerTokenFromHeader(req.headers.authorization);
}

/**
 * Validate a bearer token against the configured token.
 * Returns true if token is valid, false otherwise.
 */
export function validateBearerToken(
  providedToken: string | undefined,
  expectedToken: string
): boolean {
  if (!providedToken) return false;
  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(providedToken, expectedToken);
}

/**
 * Send a 401 Unauthorized response with a WWW-Authenticate header.
 */
/**
 * Build a 401 Unauthorized response with a WWW-Authenticate header. Web
 * standard shape, because the listen endpoint is served as a fetch handler.
 */
export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized", message: "Bearer token required" }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="MCPico"',
      },
    }
  );
}

// ── Constant-time string comparison ──

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still compare to avoid leaking length via timing
    const maxLen = Math.max(a.length, b.length);
    let result = 0;
    for (let i = 0; i < maxLen; i++) {
      result |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
