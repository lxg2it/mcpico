#!/usr/bin/env node
/**
 * Token comparison: Flat MCP tools vs MCPico grouped tools.
 *
 * Simulates realistic MCP servers (filesystem, postgres, slack, jira, redis)
 * and measures the raw JSON size of tools/list responses.
 *
 * Token estimate: chars / 4 (conservative — matches tiktoken counts closely).
 */

// ── Realistic tool definitions ────────────────────────────────────

/** Generate a realistic input schema for a tool */
function schema(props = {}) {
  const s = { type: "object", properties: {} };
  for (const [name, config] of Object.entries(props)) {
    s.properties[name] = {
      type: config.type || "string",
      description: config.desc || `The ${name} parameter`,
    };
    if (config.enum) s.properties[name].enum = config.enum;
    if (config.required !== false) {
      s.required = s.required || [];
      s.required.push(name);
    }
  }
  return s;
}

/** A typical filesystem MCP server */
const filesystemTools = [
  {
    name: "fs_read_file",
    description: "Read the contents of a file at the specified path",
    inputSchema: schema({
      path: { desc: "Absolute path to the file" },
      encoding: { desc: "File encoding (utf-8, base64, etc.)", required: false },
      offset: { type: "number", desc: "Line number to start reading from", required: false },
      limit: { type: "number", desc: "Maximum number of lines to read", required: false },
    }),
  },
  {
    name: "fs_write_file",
    description: "Create or overwrite a file with the given content",
    inputSchema: schema({
      path: { desc: "Absolute path to the file" },
      content: { desc: "Content to write to the file" },
    }),
  },
  {
    name: "fs_edit_file",
    description: "Make surgical edits to an existing file",
    inputSchema: schema({
      path: { desc: "Absolute path to the file" },
      operation: { enum: ["replace", "insert_after", "insert_before", "delete"], desc: "Edit operation" },
      match: { desc: "Text or pattern to find" },
      replacement: { desc: "Replacement text", required: false },
      content: { desc: "Content to insert", required: false },
      regex: { type: "boolean", desc: "Treat match as regex", required: false },
      all: { type: "boolean", desc: "Replace all occurrences", required: false },
    }),
  },
  {
    name: "fs_list_directory",
    description: "List contents of a directory",
    inputSchema: schema({
      path: { desc: "Absolute path to the directory" },
      recursive: { type: "boolean", desc: "List subdirectories recursively", required: false },
      pattern: { desc: "Glob pattern to filter results", required: false },
    }),
  },
  {
    name: "fs_move",
    description: "Move or rename a file or directory",
    inputSchema: schema({
      source: { desc: "Source path" },
      destination: { desc: "Destination path" },
    }),
  },
  {
    name: "fs_copy",
    description: "Copy a file or directory",
    inputSchema: schema({
      source: { desc: "Source path" },
      destination: { desc: "Destination path" },
      recursive: { type: "boolean", desc: "Copy directories recursively", required: false },
    }),
  },
  {
    name: "fs_delete",
    description: "Delete a file or directory",
    inputSchema: schema({
      path: { desc: "Absolute path to delete" },
      recursive: { type: "boolean", desc: "Delete directories recursively", required: false },
    }),
  },
  {
    name: "fs_search",
    description: "Search for files matching a pattern",
    inputSchema: schema({
      pattern: { desc: "Search pattern (glob or regex)" },
      path: { desc: "Base directory to search from", required: false },
      maxResults: { type: "number", desc: "Maximum results to return", required: false },
    }),
  },
  {
    name: "fs_get_info",
    description: "Get file metadata (size, modified date, permissions)",
    inputSchema: schema({
      path: { desc: "Absolute path to the file" },
    }),
  },
  {
    name: "fs_mkdir",
    description: "Create a new directory",
    inputSchema: schema({
      path: { desc: "Absolute path for the new directory" },
    }),
  },
];

/** A typical postgres/database MCP server */
const postgresTools = [
  {
    name: "postgres_query",
    description: "Execute a read-only SQL query against the database",
    inputSchema: schema({
      sql: { desc: "SQL query to execute (SELECT only)" },
      params: { type: "array", desc: "Parameterized query values", required: false },
    }),
  },
  {
    name: "postgres_execute",
    description: "Execute a write SQL statement (INSERT, UPDATE, DELETE)",
    inputSchema: schema({
      sql: { desc: "SQL statement to execute" },
      params: { type: "array", desc: "Parameterized values", required: false },
    }),
  },
  {
    name: "postgres_list_tables",
    description: "List all tables in the database with their sizes",
    inputSchema: schema({
      schema: { desc: "Schema name (default: public)", required: false },
    }),
  },
  {
    name: "postgres_describe",
    description: "Show column information for a table",
    inputSchema: schema({
      table: { desc: "Table name to describe" },
    }),
  },
  {
    name: "postgres_create_table",
    description: "Create a new table with specified columns",
    inputSchema: schema({
      name: { desc: "Table name" },
      columns: { type: "array", desc: "Column definitions [{name, type, constraints}]" },
    }),
  },
  {
    name: "postgres_drop_table",
    description: "Drop a table (with safety confirmation)",
    inputSchema: schema({
      name: { desc: "Table name to drop" },
      confirm: { type: "boolean", desc: "Must be true to proceed" },
    }),
  },
  {
    name: "postgres_index",
    description: "Create an index on a table",
    inputSchema: schema({
      table: { desc: "Table name" },
      columns: { type: "array", desc: "Column names to index" },
      unique: { type: "boolean", desc: "Create unique index", required: false },
    }),
  },
  {
    name: "postgres_schema",
    description: "Get the full database schema as DDL statements",
    inputSchema: schema({
      format: { enum: ["json", "sql", "mermaid"], desc: "Output format", required: false },
    }),
  },
];

/** A typical Slack MCP server */
const slackTools = [
  {
    name: "slack_send_message",
    description: "Send a message to a Slack channel",
    inputSchema: schema({
      channel: { desc: "Channel ID or name (e.g., #general)" },
      text: { desc: "Message text (supports mrkdwn)" },
      thread_ts: { desc: "Thread timestamp to reply in thread", required: false },
    }),
  },
  {
    name: "slack_list_channels",
    description: "List all accessible Slack channels",
    inputSchema: schema({
      types: { desc: "Channel types (public_channel, private_channel)", required: false },
    }),
  },
  {
    name: "slack_list_users",
    description: "List all workspace users with status",
    inputSchema: schema({
      include_deleted: { type: "boolean", desc: "Include deleted users", required: false },
    }),
  },
  {
    name: "slack_get_history",
    description: "Get message history from a channel",
    inputSchema: schema({
      channel: { desc: "Channel ID" },
      limit: { type: "number", desc: "Max messages (default: 100)", required: false },
      oldest: { desc: "Start timestamp", required: false },
    }),
  },
  {
    name: "slack_add_reaction",
    description: "Add an emoji reaction to a message",
    inputSchema: schema({
      channel: { desc: "Channel ID" },
      timestamp: { desc: "Message timestamp" },
      name: { desc: "Emoji name (without colons)" },
    }),
  },
  {
    name: "slack_search",
    description: "Search messages and files in Slack",
    inputSchema: schema({
      query: { desc: "Search query" },
      sort: { enum: ["score", "timestamp"], required: false, desc: "Sort order" },
      count: { type: "number", desc: "Max results (default: 20)", required: false },
    }),
  },
  {
    name: "slack_upload_file",
    description: "Upload a file to a Slack channel",
    inputSchema: schema({
      channel: { desc: "Channel ID" },
      filepath: { desc: "Local file path to upload" },
      title: { desc: "File title", required: false },
      initial_comment: { desc: "Comment to post with the file", required: false },
    }),
  },
  {
    name: "slack_create_channel",
    description: "Create a new Slack channel",
    inputSchema: schema({
      name: { desc: "Channel name (lowercase, no spaces)" },
      is_private: { type: "boolean", desc: "Make it private", required: false },
    }),
  },
];

/** Jira MCP tools */
const jiraTools = [
  {
    name: "jira_search",
    description: "Search Jira issues using JQL",
    inputSchema: schema({
      jql: { desc: "JQL query string" },
      maxResults: { type: "number", desc: "Max results (default: 50)", required: false },
    }),
  },
  {
    name: "jira_get_issue",
    description: "Get full details of a specific issue",
    inputSchema: schema({
      key: { desc: "Issue key (e.g., PROJ-1234)" },
    }),
  },
  {
    name: "jira_create_issue",
    description: "Create a new Jira issue",
    inputSchema: schema({
      project: { desc: "Project key" },
      type: { enum: ["Bug", "Task", "Story", "Epic"], desc: "Issue type" },
      summary: { desc: "Issue summary/title" },
      description: { desc: "Detailed description", required: false },
      priority: { enum: ["Highest", "High", "Medium", "Low", "Lowest"], required: false, desc: "Priority" },
      assignee: { desc: "Assignee username", required: false },
    }),
  },
  {
    name: "jira_update_issue",
    description: "Update fields on an existing issue",
    inputSchema: schema({
      key: { desc: "Issue key" },
      summary: { desc: "New summary", required: false },
      description: { desc: "New description", required: false },
      status: { desc: "New status", required: false },
      assignee: { desc: "New assignee", required: false },
    }),
  },
  {
    name: "jira_add_comment",
    description: "Add a comment to an issue",
    inputSchema: schema({
      key: { desc: "Issue key" },
      body: { desc: "Comment text" },
      visibility: { enum: ["public", "internal"], required: false, desc: "Comment visibility" },
    }),
  },
  {
    name: "jira_list_projects",
    description: "List all accessible Jira projects",
    inputSchema: {},
  },
  {
    name: "jira_get_sprints",
    description: "Get sprint information for a board",
    inputSchema: schema({
      boardId: { type: "number", desc: "Board ID" },
      state: { enum: ["active", "future", "closed"], required: false },
    }),
  },
];

/** Redis MCP tools */
const redisTools = [
  { name: "redis_get", description: "Get a key's value from Redis", inputSchema: schema({ key: {} }) },
  {
    name: "redis_set",
    description: "Set a key-value pair with optional expiry",
    inputSchema: schema({
      key: {},
      value: {},
      ttl: { type: "number", desc: "Expiry in seconds", required: false },
    }),
  },
  { name: "redis_del", description: "Delete one or more keys", inputSchema: schema({ keys: { type: "array" } }) },
  {
    name: "redis_expire",
    description: "Set expiry on a key",
    inputSchema: schema({ key: {}, seconds: { type: "number" } }),
  },
  {
    name: "redis_keys",
    description: "Find keys matching a pattern",
    inputSchema: schema({ pattern: { desc: "Glob pattern (e.g., user:*)" } }),
  },
  { name: "redis_exists", description: "Check if a key exists", inputSchema: schema({ key: {} }) },
  {
    name: "redis_incr",
    description: "Increment a counter",
    inputSchema: schema({ key: {}, amount: { type: "number", desc: "Increment amount (default: 1)", required: false } }),
  },
  {
    name: "redis_hget",
    description: "Get a field from a hash",
    inputSchema: schema({ key: {}, field: {} }),
  },
  {
    name: "redis_hset",
    description: "Set a field in a hash",
    inputSchema: schema({ key: {}, field: {}, value: {} }),
  },
  {
    name: "redis_lpush",
    description: "Push to the left of a list",
    inputSchema: schema({ key: {}, values: { type: "array" } }),
  },
  { name: "redis_lrange", description: "Get a range from a list", inputSchema: schema({ key: {}, start: { type: "number" }, stop: { type: "number" } }) },
  { name: "redis_llen", description: "Get the length of a list", inputSchema: schema({ key: {} }) },
];

// ── Simulate MCPico grouping ─────────────────────────────────────

/**
 * Mimics MCPico's prefix-based grouping.
 * Separator: "_" (underscore is the default).
 */
function groupToolsByName(tools, separator = "_") {
  const groups = new Map();
  const ungrouped = [];

  for (const tool of tools) {
    const idx = tool.name.indexOf(separator);
    if (idx > 0 && idx < tool.name.length - 1) {
      const prefix = tool.name.slice(0, idx);
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(tool.name);
    } else {
      ungrouped.push(tool);
    }
  }

  const result = [];
  for (const [name, commands] of groups) {
    result.push({ groupName: name, commandCount: commands.length, commands });
  }
  if (ungrouped.length > 0) {
    result.push({ groupName: "other", commandCount: ungrouped.length, commands: ungrouped.map(t => t.name) });
  }
  return result;
}

/**
 * Build MCPico-style tools/list response.
 * Each group becomes a tool with a single `command` parameter.
 */
function buildMcpicoToolList(groups) {
  const tools = [];
  for (const g of groups) {
    tools.push({
      name: g.groupName,
      description: `MCPico: ${g.groupName} — ${g.commandCount} subcommand${g.commandCount === 1 ? "" : "s"}: ${g.commands.join(", ")}`,
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: `Use 'help' for full docs or '<subcommand> {"key":"value",...}' to execute. ${g.commandCount} subcommand${g.commandCount === 1 ? "" : "s"} available.`,
          },
        },
        required: ["command"],
      },
    });
  }
  return { tools };
}

// ── Run comparison ────────────────────────────────────────────────

const allTools = [...filesystemTools, ...postgresTools, ...slackTools, ...jiraTools, ...redisTools];
const flatJson = JSON.stringify({ tools: allTools });
const groups = groupToolsByName(allTools);
const groupedJson = JSON.stringify(buildMcpicoToolList(groups));

const flatTokens = Math.round(flatJson.length / 4);
const groupedTokens = Math.round(groupedJson.length / 4);
const savings = flatTokens - groupedTokens;
const pct = Math.round((savings / flatTokens) * 100);

console.log(`╔══════════════════════════════════════════════════════════╗`);
console.log(`║     MCPico Token Comparison: Flat vs Grouped Tools       ║`);
console.log(`╠══════════════════════════════════════════════════════════╣`);
console.log(`║                                                          ║`);
console.log(`║  Upstream servers:  filesystem, postgres, slack, jira, redis`);
console.log(`║  Total tools:       ${String(allTools.length).padStart(3)}`);
console.log(`║  Groups created:    ${String(groups.length).padStart(3)}`);
console.log(`║                                                          ║`);
console.log(`║  Flat tools/list:   ${String(flatJson.length).padStart(5)} bytes  →  ~${String(flatTokens).padStart(4)} tokens`);
console.log(`║  MCPico tools/list: ${String(groupedJson.length).padStart(5)} bytes  →  ~${String(groupedTokens).padStart(4)} tokens`);
console.log(`║                                                          ║`);
console.log(`║  Savings:           ${String(savings).padStart(4)} tokens  (${String(pct).padStart(2)}%)`);
console.log(`║                                                          ║`);
console.log(`║  Sample groups:                                          ║`);
for (const g of groups) {
  console.log(`║    ${g.groupName.padEnd(14)} ${String(g.commandCount).padStart(2)} commands: ${g.commands.slice(0, 3).join(", ")}${g.commands.length > 3 ? "..." : ""}`);
}
console.log(`║                                                          ║`);
console.log(`╚══════════════════════════════════════════════════════════╝`);
