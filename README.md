# MCPico

**MCP proxy that bundles flat tool lists into hierarchical groups with separate discovery and execution.**

MCPico (MCP + "ico" = tiny) wraps upstream MCP servers, grouping their tools into discoverable groups. Each group gets a `help_<group>` discovery tool (auto-generated docs from upstream schemas) and a `<group>` execution tool. LLM benchmarks show 43–60% fewer conversation tokens while matching flat tool success rates.

## The Problem

MCP servers expose tools as a flat list. Every tool costs context tokens. A filesystem server exposes 14+ separate tools — the model sees all of them, all the time, even when it only needs one.

Some clients add "tool search" as a workaround. But searching requires the model to proactively look for tools it doesn't know exist. No structural signal about which tools relate to each other.

## MCPico's Solution

Group related tools under a single entry point. The model sees groups instead of raw tools. Discovery is separated from execution:

```
Model calls: help_postgres → sees available tools
Model calls: postgres_query {"sql":"SELECT ..."} → executes
```

### Quantified: 43–60% fewer conversation tokens

See **[BENCHMARK.md](BENCHMARK.md)** for a full LLM evaluation comparing flat tools (45 tools, 5 servers), MCPico merged mode, and MCPico split mode across Qwen3.5-9B and Qwen3.6-35B.

Key results:
- **MCPico split** matches flat tool success rates on both models (2/3 tasks)
- **60% token reduction** on 9B model (14,027 vs 34,760 tokens across all tasks)
- **43% token reduction** on single-tool tasks with the 35B model

## Features

- **Tool bundling** — Groups tools by prefix (configurable separator), collapsing flat tool lists into 10 tools instead of 45+
- **Split discovery/execution** — Separate `help_<group>` tools for discovery, `<group>` tools for execution. LLM-optimized design
- **Auto-generated help** — `help_<group>` tools dynamically generate rich documentation from upstream schemas
- **Multi-server aggregation** — Proxy multiple upstream MCP servers through one interface
- **Dual upstream transport** — Supports both stdio and Streamable HTTP (SSE) upstream servers
- **Dual listen transport** — MCPico itself listens via stdio or HTTP/SSE (configurable port)
- **Configurable timeouts** — Per-server connection timeout with sensible default (30s)
- **Resource & prompt passthrough** — Namespaced to avoid collisions across servers
- **Authentication** — Bearer, custom header, and OAuth2 client_credentials with automatic token refresh
- **Listen endpoint auth** — Protect the SSE endpoint with bearer token validation

## Usage

### Install

```bash
npm install -g mcpico
```

### Configure

Create `mcpico.json`:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
      }
    }
  ]
}
```

### Run

```bash
mcpico
```

### Connect your MCP client

Add MCPico as a server in your MCP client config:

```json
{
  "mcpServers": {
    "mcpico": {
      "command": "mcpico",
      "args": ["--config", "/path/to/mcpico.json"]
    }
  }
}
```

## How it works

1. **Connect** to upstream MCP servers
2. **Discover** their tools (`tools/list`)
3. **Group** tools by prefix (configurable separator, default `_`)
   - `filesystem_read_file`, `filesystem_write_file` → group `filesystem`
4. **Register** two tools per group:
   - `help_<group>` — discovery: lists all subcommands with their parameters
   - `<group>` — execution: takes `subcommand` + `params`, forwards to upstream
5. **Forward** tool calls directly to the matching upstream server
6. **Generate help** dynamically from original tool schemas

### Tool interface

```
help_postgres          ← call with no arguments to discover
postgres               ← call with subcommand: "postgres_query", params: {sql: "..."}
```

### Multi-server aggregation

MCPico can proxy multiple upstream servers simultaneously:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      }
    },
    {
      "name": "github",
      "transport": {
        "type": "sse",
        "url": "https://mcp-github.example.com/mcp"
      }
    }
  ]
}
```

Groups from different servers are merged if they share a prefix. Otherwise each server's tools appear as separate groups.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `servers` | `ServerConfig[]` | **required** | Upstream MCP servers to proxy |
| `separator` | `string` | `"_"` | Separator for prefix-based tool grouping |
| `groups` | `object` | `{}` | Explicit group overrides (`{ "group": ["tool1","tool2"] }`) |
| `listen` | `ListenConfig` | `{"type":"stdio"}` | How MCPico exposes itself to MCP clients |

### ListenConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"stdio"` | yes | Standard stdio transport |
| `type` | `"sse"` | yes | HTTP/SSE — specify `port` and optional `host` |

```json
// SSE listen mode — MCPico as an HTTP endpoint
{
  "servers": [...],
  "listen": {
    "type": "sse",
    "port": 3000
  }
}
```

### ServerConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Friendly name / group namespace |
| `transport` | `TransportConfig` | yes | How to connect to the upstream server |
| `connectTimeoutMs` | `number` | no | Connection timeout in ms (default: 30000) |

### TransportConfig (stdio)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"stdio"` | yes | Transport type |
| `command` | `string` | yes | Executable to spawn |
| `args` | `string[]` | no | Command-line arguments |
| `env` | `object` | no | Environment variables |
| `cwd` | `string` | no | Working directory |

### TransportConfig (SSE / Streamable HTTP)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"sse"` | yes | Transport type |
| `url` | `string` | yes | Full URL to MCP Streamable HTTP endpoint |

## Authentication

MCPico supports two layers of authentication:

### Layer 1: Protecting the listen endpoint

When MCPico exposes an SSE endpoint, you can require a bearer token from clients:

```json
{
  "servers": [...],
  "listen": {
    "type": "sse",
    "port": 3000,
    "auth": {
      "type": "bearer",
      "token": "${MCPICO_API_KEY}"
    }
  }
}
```

Clients must include `Authorization: Bearer <token>` in requests. Invalid or missing tokens receive a 401 response.

### Layer 2: Authenticating to upstream servers

Upstream servers can require authentication. MCPico supports three methods:

**Bearer token** — standard `Authorization: Bearer <token>` header:

```json
{
  "servers": [
    {
      "name": "internal-api",
      "transport": {
        "type": "sse",
        "url": "https://api.internal/mcp"
      },
      "auth": {
        "type": "bearer",
        "token": "${INTERNAL_KEY}"
      }
    }
  ]
}
```

**Custom header** — arbitrary headers (e.g. `X-API-Key`):

```json
{
  "auth": {
    "type": "header",
    "name": "X-API-Key",
    "value": "${WIDGET_KEY}"
  }
}
```

**OAuth 2.0 client credentials** — machine-to-machine authentication with automatic token refresh:

```json
{
  "auth": {
    "type": "oauth",
    "grant_type": "client_credentials",
    "client_id": "${PROVIDER_CLIENT_ID}",
    "client_secret": "${PROVIDER_CLIENT_SECRET}",
    "token_url": "https://auth.example.com/oauth/token",
    "scopes": ["read", "write"]
  }
}
```

MCPico handles the full OAuth flow:
- Fetches initial access token on startup
- Caches tokens in `~/.mcplico/credentials.json`
- Automatically refreshes before expiry
- Retries on 401 with fresh tokens

All auth fields support `${ENV_VAR}` interpolation — never hardcode secrets.

### Auth config reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `auth.type` | `"bearer"` \| `"header"` \| `"oauth"` | yes | Auth method |
| `auth.token` | `string` | for `bearer` | Bearer token value |
| `auth.name` | `string` | for `header` | Header name |
| `auth.value` | `string` | for `header` | Header value |
| `auth.grant_type` | `"client_credentials"` | for `oauth` | OAuth grant type |
| `auth.client_id` | `string` | for `oauth` | OAuth client ID |
| `auth.client_secret` | `string` | for `oauth` | OAuth client secret |
| `auth.token_url` | `string` | for `oauth` | Token endpoint URL |
| `auth.scopes` | `string[]` | no | OAuth scopes to request |
| `auth.authorization_server_url` | `string` | no | Auth server URL (if different from token_url issuer) |

## Development
## Development

```bash
npm install
npm run build    # TypeScript compilation
npm test         # Run tests (138 tests, vitest)
npm run dev      # Run directly with tsx
```

## License

MIT
