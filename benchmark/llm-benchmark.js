#!/usr/bin/env node
/**
 * MCPico LLM Benchmark: Flat vs Grouped Tool Schemas
 *
 * Measures real LLM performance comparing:
 * - Flat: All tools directly available (traditional MCP)
 * - MCPico: Groups only, model discovers tools via `help <group>`
 *
 * Uses oMLX locally for zero-cost evaluation.
 */

const MODEL = "Qwen3.6-35B-A3B-Uncensored-Heretic-MLX-6bit";
const OMLX = "http://localhost:21434/v1/chat/completions";

// ── Test task definitions ──────────────────────────────────────

const TASKS = [
  {
    id: "single-tool-fs",
    description: "Read a specific file",
    userMessage: "Read the contents of /tmp/config.json and tell me what you find.",
    expectedTool: "fs_read_file",
    expectedArgs: { path: "/tmp/config.json" },
  },
  {
    id: "same-group-multi",
    description: "Read file then write based on content",
    userMessage: "Read /tmp/status.txt. If it contains the word 'active', write 'System is running' to /tmp/report.txt.",
    expectedTools: ["fs_read_file", "fs_write_file"],
    needsContent: true,
  },
  {
    id: "cross-group",
    description: "Query database + send Slack notification",
    userMessage: "Run 'SELECT count(*) FROM users' on the database, then send the result to the #general channel on Slack.",
    expectedTools: ["postgres_query", "slack_send_message"],
    needsContent: true,
  },
  {
    id: "discovery",
    description: "Discover available tools for caching",
    userMessage: "I need to store a temporary value in a key-value cache, but I don't know what tools are available for that. Find the right tools and list them.",
    expectedAction: "help",
    expectedGroup: "redis",
  },
  {
    id: "complex-fs",
    description: "Filesystem search + read",
    userMessage: "Find all .md files under /tmp/docs/, then read the newest one.",
    expectedTools: ["fs_search", "fs_read_file"],
    needsContent: true,
  },
];

// ── Tool definitions ───────────────────────────────────────────

const ALL_TOOLS = [
  // Filesystem (10 tools)
  { name: "fs_read_file", description: "Read the contents of a file", schema: { type: "object", properties: { path: { type: "string", description: "Absolute path to the file" }, encoding: { type: "string", description: "File encoding" }, offset: { type: "number", description: "Line number to start from" }, limit: { type: "number", description: "Max lines to read" } }, required: ["path"] } },
  { name: "fs_write_file", description: "Create or overwrite a file", schema: { type: "object", properties: { path: { type: "string", description: "Absolute path" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] } },
  { name: "fs_edit_file", description: "Make surgical edits to a file", schema: { type: "object", properties: { path: { type: "string" }, operation: { type: "string", enum: ["replace", "insert_after", "insert_before", "delete"] }, match: { type: "string", description: "Text to find" }, replacement: { type: "string" } }, required: ["path", "operation", "match"] } },
  { name: "fs_list_directory", description: "List contents of a directory", schema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" }, pattern: { type: "string" } }, required: ["path"] } },
  { name: "fs_move", description: "Move or rename a file or directory", schema: { type: "object", properties: { source: { type: "string" }, destination: { type: "string" } }, required: ["source", "destination"] } },
  { name: "fs_copy", description: "Copy a file or directory", schema: { type: "object", properties: { source: { type: "string" }, destination: { type: "string" }, recursive: { type: "boolean" } }, required: ["source", "destination"] } },
  { name: "fs_delete", description: "Delete a file or directory", schema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"] } },
  { name: "fs_search", description: "Search for files matching a pattern", schema: { type: "object", properties: { pattern: { type: "string", description: "Search pattern" }, path: { type: "string" }, maxResults: { type: "number" } }, required: ["pattern"] } },
  { name: "fs_get_info", description: "Get file metadata", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "fs_mkdir", description: "Create a directory", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },

  // Postgres (8 tools)
  { name: "postgres_query", description: "Execute a read-only SQL query", schema: { type: "object", properties: { sql: { type: "string", description: "SQL query" }, params: { type: "array" } }, required: ["sql"] } },
  { name: "postgres_execute", description: "Execute a write SQL statement", schema: { type: "object", properties: { sql: { type: "string" }, params: { type: "array" } }, required: ["sql"] } },
  { name: "postgres_list_tables", description: "List all database tables", schema: { type: "object", properties: { schema: { type: "string", default: "public" } } } },
  { name: "postgres_describe", description: "Show column info for a table", schema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] } },
  { name: "postgres_create_table", description: "Create a new table", schema: { type: "object", properties: { name: { type: "string" }, columns: { type: "array" } }, required: ["name", "columns"] } },
  { name: "postgres_drop_table", description: "Drop a table (with safety)", schema: { type: "object", properties: { name: { type: "string" }, confirm: { type: "boolean" } }, required: ["name", "confirm"] } },
  { name: "postgres_index", description: "Create an index", schema: { type: "object", properties: { table: { type: "string" }, columns: { type: "array" } }, required: ["table", "columns"] } },
  { name: "postgres_schema", description: "Get full database schema as DDL", schema: { type: "object", properties: { format: { type: "string", enum: ["json", "sql", "mermaid"] } } } },

  // Slack (8 tools)
  { name: "slack_send_message", description: "Send a message to a Slack channel", schema: { type: "object", properties: { channel: { type: "string", description: "Channel ID or #name" }, text: { type: "string", description: "Message text" }, thread_ts: { type: "string" } }, required: ["channel", "text"] } },
  { name: "slack_list_channels", description: "List accessible Slack channels", schema: { type: "object", properties: { types: { type: "string" } } } },
  { name: "slack_list_users", description: "List workspace users", schema: { type: "object", properties: { include_deleted: { type: "boolean" } } } },
  { name: "slack_get_history", description: "Get message history from a channel", schema: { type: "object", properties: { channel: { type: "string" }, limit: { type: "number" }, oldest: { type: "string" } }, required: ["channel"] } },
  { name: "slack_add_reaction", description: "Add an emoji reaction", schema: { type: "object", properties: { channel: { type: "string" }, timestamp: { type: "string" }, name: { type: "string", description: "Emoji name" } }, required: ["channel", "timestamp", "name"] } },
  { name: "slack_search", description: "Search messages and files", schema: { type: "object", properties: { query: { type: "string" }, sort: { type: "string", enum: ["score", "timestamp"] }, count: { type: "number" } }, required: ["query"] } },
  { name: "slack_upload_file", description: "Upload a file to a channel", schema: { type: "object", properties: { channel: { type: "string" }, filepath: { type: "string" }, title: { type: "string" }, initial_comment: { type: "string" } }, required: ["channel", "filepath"] } },
  { name: "slack_create_channel", description: "Create a new Slack channel", schema: { type: "object", properties: { name: { type: "string" }, is_private: { type: "boolean" } }, required: ["name"] } },

  // Jira (7 tools)
  { name: "jira_search", description: "Search issues using JQL", schema: { type: "object", properties: { jql: { type: "string" }, maxResults: { type: "number" } }, required: ["jql"] } },
  { name: "jira_get_issue", description: "Get full details of an issue", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "jira_create_issue", description: "Create a new issue", schema: { type: "object", properties: { project: { type: "string" }, type: { type: "string", enum: ["Bug", "Task", "Story", "Epic"] }, summary: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["Highest", "High", "Medium", "Low", "Lowest"] }, assignee: { type: "string" } }, required: ["project", "type", "summary"] } },
  { name: "jira_update_issue", description: "Update fields on an issue", schema: { type: "object", properties: { key: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, status: { type: "string" }, assignee: { type: "string" } }, required: ["key"] } },
  { name: "jira_add_comment", description: "Add a comment to an issue", schema: { type: "object", properties: { key: { type: "string" }, body: { type: "string" }, visibility: { type: "string", enum: ["public", "internal"] } }, required: ["key", "body"] } },
  { name: "jira_list_projects", description: "List all accessible Jira projects", schema: { type: "object", properties: {} } },
  { name: "jira_get_sprints", description: "Get sprint info for a board", schema: { type: "object", properties: { boardId: { type: "number" }, state: { type: "string", enum: ["active", "future", "closed"] } }, required: ["boardId"] } },

  // Redis (12 tools)
  { name: "redis_get", description: "Get a key's value from Redis", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "redis_set", description: "Set a key-value pair with optional TTL", schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, ttl: { type: "number" } }, required: ["key", "value"] } },
  { name: "redis_del", description: "Delete one or more keys", schema: { type: "object", properties: { keys: { type: "array", items: { type: "string" } } }, required: ["keys"] } },
  { name: "redis_expire", description: "Set expiry on a key", schema: { type: "object", properties: { key: { type: "string" }, seconds: { type: "number" } }, required: ["key", "seconds"] } },
  { name: "redis_keys", description: "Find keys matching a pattern", schema: { type: "object", properties: { pattern: { type: "string", description: "Glob pattern (e.g., user:*)" } }, required: ["pattern"] } },
  { name: "redis_exists", description: "Check if a key exists", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "redis_incr", description: "Increment a counter", schema: { type: "object", properties: { key: { type: "string" }, amount: { type: "number" } }, required: ["key"] } },
  { name: "redis_hget", description: "Get a field from a hash", schema: { type: "object", properties: { key: { type: "string" }, field: { type: "string" } }, required: ["key", "field"] } },
  { name: "redis_hset", description: "Set a field in a hash", schema: { type: "object", properties: { key: { type: "string" }, field: { type: "string" }, value: { type: "string" } }, required: ["key", "field", "value"] } },
  { name: "redis_lpush", description: "Push to the left of a list", schema: { type: "object", properties: { key: { type: "string" }, values: { type: "array", items: { type: "string" } } }, required: ["key", "values"] } },
  { name: "redis_lrange", description: "Get a range from a list", schema: { type: "object", properties: { key: { type: "string" }, start: { type: "number" }, stop: { type: "number" } }, required: ["key", "start", "stop"] } },
  { name: "redis_llen", description: "Get the length of a list", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
];

// ── Group definitions (matches MCPico prefix grouping) ─────────

const GROUPS = {
  fs: { description: "Filesystem operations — 10 subcommands: read_file, write_file, edit_file, list_directory, move, copy, delete, search, get_info, mkdir", tools: ALL_TOOLS.filter(t => t.name.startsWith("fs_")) },
  postgres: { description: "PostgreSQL database operations — 8 subcommands: query, execute, list_tables, describe, create_table, drop_table, index, schema", tools: ALL_TOOLS.filter(t => t.name.startsWith("postgres_")) },
  slack: { description: "Slack workspace operations — 8 subcommands: send_message, list_channels, list_users, get_history, add_reaction, search, upload_file, create_channel", tools: ALL_TOOLS.filter(t => t.name.startsWith("slack_")) },
  jira: { description: "Jira issue tracking — 7 subcommands: search, get_issue, create_issue, update_issue, add_comment, list_projects, get_sprints", tools: ALL_TOOLS.filter(t => t.name.startsWith("jira_")) },
  redis: { description: "Redis key-value cache — 12 subcommands: get, set, del, expire, keys, exists, incr, hget, hset, lpush, lrange, llen", tools: ALL_TOOLS.filter(t => t.name.startsWith("redis_")) },
};

// ── OpenAI-compatible tool format ───────────────────────────────

function toOpenAITool(t) {
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.schema } };
}

function toMcpicoGroupTool(name, info) {
  return {
    type: "function",
    function: {
      name,
      description: `MCPico: ${name} — ${info.description}`,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: `Use 'help' for full subcommand docs or '<subcommand> {"key":"value",...}' to execute. ${info.tools.length} subcommands available.` },
        },
        required: ["command"],
      },
    },
  };
}

const flatTools = ALL_TOOLS.map(toOpenAITool);
const groupTools = Object.entries(GROUPS).map(([name, info]) => toMcpicoGroupTool(name, info));

// ── LLM call ────────────────────────────────────────────────────

async function chat(messages, tools, maxTokens = 300) {
  const resp = await fetch(OMLX, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools, max_tokens: maxTokens, temperature: 0 }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ── Simulate tool result ────────────────────────────────────────

function simulateHelp(groupName) {
  const info = GROUPS[groupName];
  if (!info) return `Unknown group "${groupName}". Available groups: ${Object.keys(GROUPS).join(", ")}`;
  const tools = info.tools.map(t => `  - ${t.name}: ${t.description}\n    params: ${JSON.stringify(t.schema.properties || {})}`).join("\n");
  return `Group "${groupName}" subcommands:\n${tools}`;
}

function simulateToolResult(toolName, args) {
  // Return realistic dummy results
  if (toolName === "fs_read_file") return `Contents of ${args.path}: {"status": "active", "version": "1.0"}`;
  if (toolName === "fs_write_file") return `Written to ${args.path}`;
  if (toolName === "fs_search") return `Found: /tmp/docs/README.md (2026-06-01), /tmp/docs/notes.md (2026-06-15), /tmp/docs/new.md (2026-06-21)`;
  if (toolName === "postgres_query") return `Query result: ${args.sql} → [{"count": "42"}]`;
  if (toolName === "slack_send_message") return `Message sent to ${args.channel}`;
  if (toolName === "redis_set") return "OK";
  if (toolName === "redis_get") return "my_value";
  return `Executed ${toolName} with ${JSON.stringify(args)}`;
}

// ── Run a single benchmark case ─────────────────────────────────

async function runCase(task, mode) {
  const isFlat = mode === "flat";
  const tools = isFlat ? flatTools : groupTools;
  let messages = [{ role: "user", content: task.userMessage }];
  const stats = { mode, taskId: task.id, toolCalls: 0, helpCalls: 0, totalTokens: 0, calls: [], success: false };
  const maxTurns = 6;

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await chat(messages, tools);
    stats.totalTokens += result.usage?.total_tokens || 0;
    const msg = result.choices[0].message;

    // Check for tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        stats.toolCalls++;
        const fn = tc.function;
        const args = JSON.parse(fn.arguments || "{}");
        stats.calls.push(fn.name);

        let toolResult;
        if (fn.name === "help" || Object.keys(GROUPS).includes(fn.name)) {
          // In grouped mode, check if model is using help (either via a 'help' tool or by passing help command to group)
          stats.helpCalls++;
        }

        if (isFlat) {
          toolResult = simulateToolResult(fn.name, args);
        } else {
          // MCPico mode: the model called a group tool
          const cmd = (args.command || "").trim();
          if (cmd === "help" || cmd === "" || cmd === fn.name) {
            stats.helpCalls++;
            toolResult = simulateHelp(fn.name);
          } else {
            // Parse subcommand and args.
            // Model might pass: "read_file {\"path\":\"/tmp/x\"}" or just "/tmp/config.json"
            const spaceIdx = cmd.indexOf(" ");
            let subcommand, subArgs;
            if (spaceIdx > 0) {
              subcommand = cmd.slice(0, spaceIdx);
              const argsStr = cmd.slice(spaceIdx + 1).trim();
              try { subArgs = JSON.parse(argsStr); }
              catch { subArgs = { value: argsStr }; } // fallback: treat as positional
            } else {
              // No space — could be just a subcommand name or a bare value
              const knownSub = GROUPS[fn.name]?.tools.find(t => t.name.endsWith("_" + cmd));
              if (knownSub) {
                subcommand = knownSub.name;
                subArgs = {};
              } else {
                subcommand = cmd;
                subArgs = {};
              }
            }
            toolResult = simulateToolResult(subcommand, subArgs);
          }
        }

        // Add assistant message + tool result
        messages.push({ role: "assistant", content: null, tool_calls: msg.tool_calls });
        messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      }
    } else {
      // Model gave a text response — task complete
      const content = (msg.content || "").toLowerCase();
      stats.finalResponse = msg.content;

      // Check success
      if (task.expectedAction === "help") {
        stats.success = content.includes(task.expectedGroup || "redis") || stats.calls.some(c => c === "redis");
      } else if (Array.isArray(task.expectedTools)) {
        const allFound = task.expectedTools.every(et => stats.calls.some(c => c === et || (isFlat ? c === et : c.startsWith(et.split("_")[0]) && stats.calls.length > 0)));
        stats.success = allFound;
      } else if (task.expectedTool) {
        stats.success = stats.calls.includes(task.expectedTool) ||
          (!isFlat && stats.calls.some(c => c.startsWith(task.expectedTool.split("_")[0])));
      } else {
        stats.success = stats.calls.length > 0;
      }
      break;
    }
  }

  return stats;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     MCPico LLM Benchmark: Flat vs Grouped Tool Schemas       ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log(`║  Model:  ${MODEL.padEnd(54)}║`);
  console.log(`║  Tools:  ${ALL_TOOLS.length} total across 5 servers (fs, postgres, slack, jira, redis)`);
  console.log(`║  Tasks:  ${TASKS.length} scenarios`);
  console.log("╠═══════════════════════════════════════════════════════════════╣");

  const allResults = [];

  for (const task of TASKS) {
    console.log(`║                                                               ║`);
    console.log(`║  Task: ${task.description.padEnd(54)}║`);
    console.log(`║  "${task.userMessage.slice(0, 50)}..."`.padEnd(67) + "║");

    // Run flat first
    process.stdout.write(`║    Flat...   `);
    const flatResult = await runCase(task, "flat");
    console.log(`${flatResult.toolCalls} calls, ${flatResult.totalTokens} tokens, ${flatResult.success ? "✓" : "✗"}`);

    // Then grouped
    process.stdout.write(`║    MCPico... `);
    const groupedResult = await runCase(task, "grouped");
    console.log(`${groupedResult.toolCalls} calls (${groupedResult.helpCalls} help), ${groupedResult.totalTokens} tokens, ${groupedResult.success ? "✓" : "✗"}`);

    allResults.push({ task: task.id, flat: flatResult, grouped: groupedResult });
  }

  // Summary
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log("║                          SUMMARY                              ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");

  const flatTotal = allResults.reduce((s, r) => s + r.flat.totalTokens, 0);
  const groupedTotal = allResults.reduce((s, r) => s + r.grouped.totalTokens, 0);
  const flatSuccess = allResults.filter(r => r.flat.success).length;
  const groupedSuccess = allResults.filter(r => r.grouped.success).length;
  const flatCalls = allResults.reduce((s, r) => s + r.flat.toolCalls, 0);
  const groupedCalls = allResults.reduce((s, r) => s + r.grouped.toolCalls, 0);
  const helpCalls = allResults.reduce((s, r) => s + r.grouped.helpCalls, 0);

  console.log(`║                                                               ║`);
  console.log(`║              ${"Flat".padEnd(12)} ${"MCPico".padEnd(12)}`);
  console.log(`║  Success:    ${String(flatSuccess + "/" + TASKS.length).padEnd(12)} ${String(groupedSuccess + "/" + TASKS.length).padEnd(12)}`);
  console.log(`║  Tokens:     ${String(flatTotal).padEnd(12)} ${String(groupedTotal).padEnd(12)}`);
  console.log(`║  Tool calls: ${String(flatCalls).padEnd(12)} ${String(groupedCalls).padEnd(12)} (${helpCalls} help)`);
  console.log(`║                                                               ║`);

  const tokenDiff = flatTotal - groupedTotal;
  const tokenPct = Math.round((tokenDiff / flatTotal) * 100);
  if (tokenDiff > 0) {
    console.log(`║  MCPico saved ${tokenDiff} tokens (${tokenPct}%) across ${TASKS.length} tasks`);
  } else {
    console.log(`║  MCPico used ${-tokenDiff} more tokens (${-tokenPct}%)`);
  }
  console.log(`║  Flat success: ${flatSuccess}/${TASKS.length}  MCPico success: ${groupedSuccess}/${TASKS.length}`);
  console.log(`║                                                               ║`);
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  // Detailed results
  console.log("\nPer-task details:");
  for (const r of allResults) {
    console.log(`  ${r.task}:`);
    console.log(`    Flat:    ${r.flat.toolCalls} calls, ${r.flat.totalTokens} tokens, ${r.flat.success ? "✓" : "✗"}  [${r.flat.calls.join(" → ")}]`);
    console.log(`    MCPico:  ${r.grouped.toolCalls} calls (${r.grouped.helpCalls} help), ${r.grouped.totalTokens} tokens, ${r.grouped.success ? "✓" : "✗"}  [${r.grouped.calls.join(" → ")}]`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
