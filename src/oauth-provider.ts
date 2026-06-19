/**
 * OAuth client_credentials provider for MCPico.
 *
 * Implements the MCP SDK's OAuthClientProvider interface so that
 * StreamableHTTPClientTransport handles auth discovery, token exchange,
 * and refresh automatically.
 */
import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { loadTokens, saveTokens, clearTokens } from "./token-store.js";

/**
 * Create an OAuthClientProvider for client_credentials grant.
 *
 * Uses a fixed server URL for token storage key and provides
 * client metadata from config. The MCP SDK handles:
 *  - RFC 9728 resource metadata discovery
 *  - RFC 8414 authorization server metadata discovery
 *  - Token exchange
 *  - Token refresh via refreshAuthorization()
 */
export function createClientCredentialsProvider(
  clientId: string,
  clientSecret: string,
  serverUrl: string,
): OAuthClientProvider {
  return new ClientCredentialsProvider(clientId, clientSecret, serverUrl);
}

class ClientCredentialsProvider implements OAuthClientProvider {
  private _tokens: OAuthTokens | undefined;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private serverUrl: string,
  ) {
    // Load any cached tokens on creation
    this._tokens = loadTokens(serverUrl);
  }

  get redirectUrl(): string | URL | undefined {
    // client_credentials is non-interactive — no redirect URL
    return undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: ["http://localhost:0/mcplico-callback"],
      grant_types: ["client_credentials"],
      client_name: "MCPico",
    };
  }

  // Client information for token exchange
  clientInformation(): OAuthClientInformationMixed | undefined {
    return {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      client_secret_expires_at: 0, // Never expires
    };
  }

  // Return cached tokens (or undefined for initial auth)
  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  // Persist tokens after successful auth/refresh
  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
    saveTokens(this.serverUrl, tokens);
  }

  // No redirect needed for client_credentials
  redirectToAuthorization(_authorizationUrl: URL): void {
    // Non-interactive — no redirect
  }

  // PKCE not needed for client_credentials
  saveCodeVerifier(_codeVerifier: string): void {
    // No-op for client_credentials
  }

  codeVerifier(): string {
    return "";
  }

  // Use client_credentials grant
  prepareTokenRequest(
    _scope?: string,
  ): URLSearchParams | undefined {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
    });
    return params;
  }

  // Clear tokens on invalidation
  invalidateCredentials(_scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    this._tokens = undefined;
    clearTokens(this.serverUrl);
  }
}
