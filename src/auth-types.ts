/**
 * Authentication types for MCPico.
 *
 * Two layers:
 *   Layer 1 — Auth for the listen endpoint (protecting MCPico from clients)
 *   Layer 2 — Auth passthrough to upstream MCP servers
 */

// ── Upstream auth (passthrough to servers MCPico wraps) ──

export interface BearerAuth {
  type: "bearer";
  /** Bearer token value. Supports ${ENV_VAR} interpolation. */
  token: string;
}

export interface HeaderAuth {
  type: "header";
  /** Header name (e.g. "X-API-Key", "X-Auth-Token") */
  name: string;
  /** Header value. Supports ${ENV_VAR} interpolation. */
  value: string;
}

export interface OAuthClientCredentials {
  type: "oauth";
  /** OAuth 2.0 grant type */
  grant_type: "client_credentials";
  /** Client ID for the OAuth provider */
  client_id: string;
  /** Client secret for the OAuth provider */
  client_secret: string;
  /** Token endpoint URL */
  token_url: string;
  /** Optional scopes to request */
  scopes?: string[];
  /** Optional authorization server metadata URL (if different from token_url issuer) */
  authorization_server_url?: string;
}

export type UpstreamAuth = BearerAuth | HeaderAuth | OAuthClientCredentials;

// ── Listen endpoint auth (protecting MCPico from clients) ──

export interface ListenBearerAuth {
  type: "bearer";
  /** Bearer token that clients must provide. Supports ${ENV_VAR} interpolation. */
  token: string;
}

export type ListenAuth = ListenBearerAuth;

// ── Resolved auth (after env var interpolation) ──

export interface ResolvedBearerAuth {
  type: "bearer";
  token: string;
}

export interface ResolvedHeaderAuth {
  type: "header";
  name: string;
  value: string;
}

export type ResolvedUpstreamAuth =
  | ResolvedBearerAuth
  | ResolvedHeaderAuth
  | (OAuthClientCredentials & { type: "oauth" }); // OAuth is resolved at request time

export type ResolvedListenAuth = ResolvedBearerAuth;
