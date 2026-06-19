# MCPico

**MCP proxy that bundles flat tool lists into hierarchical subcommand groups.**

MCPico (MCP + "ico" = tiny) wraps upstream MCP servers, grouping their tools into discoverable subcommand-based tools. One tool per group, not one per tool. The `help` subcommand auto-generates rich documentation from upstream schemas.

## The Problem

MCP servers expose tools as a flat list. Every tool costs context tokens. A filesystem server exposes 14+ separate tools — the model sees all of them, all the time, even when it only needs one.

Some clients add "tool search" as a workaround. But searching requires the model to proactively look for tools it doesn't know exist. No structural signal about which tools relate to each other.

## MCPico's Solution

Group related tools under a single entry point. The model sees 9 groups instead of 14 tools. Discovery is built-in via `help`:

```
→ filesystem tools:
  14 tools → 9 groups: read, write, edit, create, list, directory, move, search, get
```

## Features

- **Tool bundling** — Groups tools by prefix (configurable separator), collapsing flat tool lists
- **Auto-generated help** — Each group's `help` subcommand is built from upstream tool schemas
- **Multi-server aggregation** — Proxy multiple upstream MCP servers through one interface
- **Dual transport** — Supports both stdio and Streamable HTTP (SSE) upstream servers
- **Configurable timeouts** — Per-server connection timeout with sensible default (30s)
- **Resource & prompt passthrough** — Namespaced to avoid collisions across servers

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
4. **Register** each group as a single MCP tool with a `command` string argument
5. **Forward** tool calls by parsing `<subcommand> {"key":"value"}` and proxying to upstream
6. **Generate help** dynamically from original tool schemas

### Command format

```
<subcommand> {"arg1":"val1","arg2":"val2"}
```

Examples:
- `help` — see all subcommands and their parameters
- `read_file {"path":"/tmp/hello.txt"}` — call a specific tool
- `write_file {"path":"/tmp/out.txt","content":"hello"}` — with arguments

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

## Development

```bash
npm install
npm run build    # TypeScript compilation
npm test         # Run tests (77 tests, vitest)
npm run dev      # Run directly with tsx
```

## License

MIT
