/**
 * Token store: persist OAuth tokens to ~/.mcplico/credentials.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const CREDENTIALS_DIR = join(homedir(), ".mcplico");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number; // Unix timestamp (ms)
  scope?: string;
}

interface CredentialsStore {
  [key: string]: StoredToken;
}

function ensureDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

function readStore(): CredentialsStore {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return {};
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as CredentialsStore;
  } catch {
    return {};
  }
}

function writeStore(store: CredentialsStore): void {
  ensureDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

/** Derive a storage key from server URL */
export function storageKey(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    // Use hostname + pathname to distinguish different servers
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    // Fallback for non-URL values
    return serverUrl.replace(/[^a-zA-Z0-9]/g, "_");
  }
}

/** Persist OAuth tokens for a server */
export function saveTokens(serverUrl: string, tokens: OAuthTokens): void {
  const store = readStore();
  const key = storageKey(serverUrl);
  store[key] = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined,
    scope: tokens.scope,
  };
  writeStore(store);
}

/** Load persisted OAuth tokens for a server */
export function loadTokens(serverUrl: string): OAuthTokens | undefined {
  const store = readStore();
  const key = storageKey(serverUrl);
  const stored = store[key];
  if (!stored) return undefined;
  return {
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    token_type: stored.token_type || "Bearer",
    expires_in: stored.expires_at
      ? Math.max(0, Math.floor((stored.expires_at - Date.now()) / 1000)) || undefined
      : undefined,
    scope: stored.scope,
  };
}

/** Clear stored tokens (e.g., when invalidated) */
export function clearTokens(serverUrl: string): void {
  const store = readStore();
  const key = storageKey(serverUrl);
  delete store[key];
  writeStore(store);
}

/** Check if a stored token is still valid (not expired, with 60s buffer) */
export function isTokenValid(serverUrl: string): boolean {
  const store = readStore();
  const key = storageKey(serverUrl);
  const stored = store[key];
  if (!stored || !stored.access_token) return false;
  if (!stored.expires_at) return true; // No expiry info — assume valid
  // Refresh with 60 second buffer
  return Date.now() < stored.expires_at - 60_000;
}
