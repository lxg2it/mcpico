#!/usr/bin/env node
/**
 * MCPico LLM Benchmark v2
 * Compares three tool layouts:
 *   1. Flat — all 45 tools directly available
 *   2. MCPico merged — single group tool (help + exec via command field)
 *   3. MCPico split  — separate help_<group> + <group> tools
 */

const MODEL = "Qwen3.6-35B-A3B-Uncensored-Heretic-MLX-6bit";
const OMLX = "http://localhost:21434/v1/chat/completions";

// ── Tasks ──────────────────────────────────────────────────────

const TASKS = [
  {
    id: "single",
    desc: "Read a file",
    msg: "Read the contents of /tmp/config.json and tell me what you find.",
    want: ["fs_read_file"],
  },
  {
    id: "multi-cross",
    desc: "Query DB + notify Slack",
    msg: "Run 'SELECT count(*) FROM users' on the database, then send the count to #general on Slack.",
    want: ["postgres_query", "slack_send_message"],
  },
  {
    id: "fs-complex",
    desc: "Search for files then read newest",
    msg: "Find all .md files under /tmp/docs/, then read the newest one.",
    want: ["fs_search", "fs_read_file"],
  },
];

// ── All tools ──────────────────────────────────────────────────

const ALL = [
  { name:"fs_read_file", desc:"Read file contents", props:{path:{type:"string",desc:"Absolute path"},offset:{type:"number"},limit:{type:"number"}},req:["path"] },
  { name:"fs_write_file", desc:"Create or overwrite a file", props:{path:{type:"string"},content:{type:"string"}},req:["path","content"] },
  { name:"fs_edit_file", desc:"Surgical edits to a file", props:{path:{type:"string"},operation:{type:"string",enum:["replace","insert_after","insert_before","delete"]},match:{type:"string"}},req:["path","operation","match"] },
  { name:"fs_list_directory", desc:"List directory contents", props:{path:{type:"string"},recursive:{type:"boolean"}},req:["path"] },
  { name:"fs_search", desc:"Search files by pattern", props:{pattern:{type:"string"},path:{type:"string"},maxResults:{type:"number"}},req:["pattern"] },
  { name:"fs_move", desc:"Move or rename a file", props:{source:{type:"string"},destination:{type:"string"}},req:["source","destination"] },
  { name:"fs_copy", desc:"Copy a file or directory", props:{source:{type:"string"},destination:{type:"string"},recursive:{type:"boolean"}},req:["source","destination"] },
  { name:"fs_delete", desc:"Delete a file or directory", props:{path:{type:"string"},recursive:{type:"boolean"}},req:["path"] },
  { name:"fs_get_info", desc:"Get file metadata", props:{path:{type:"string"}},req:["path"] },
  { name:"fs_mkdir", desc:"Create a directory", props:{path:{type:"string"}},req:["path"] },

  { name:"postgres_query", desc:"Execute read-only SQL", props:{sql:{type:"string"},params:{type:"array"}},req:["sql"] },
  { name:"postgres_execute", desc:"Execute write SQL", props:{sql:{type:"string"},params:{type:"array"}},req:["sql"] },
  { name:"postgres_list_tables", desc:"List all tables", props:{schema:{type:"string"}},req:[] },
  { name:"postgres_describe", desc:"Show column info for a table", props:{table:{type:"string"}},req:["table"] },
  { name:"postgres_create_table", desc:"Create a new table", props:{name:{type:"string"},columns:{type:"array"}},req:["name","columns"] },
  { name:"postgres_drop_table", desc:"Drop a table", props:{name:{type:"string"},confirm:{type:"boolean"}},req:["name","confirm"] },
  { name:"postgres_index", desc:"Create an index", props:{table:{type:"string"},columns:{type:"array"}},req:["table","columns"] },
  { name:"postgres_schema", desc:"Get full schema", props:{format:{type:"string",enum:["json","sql","mermaid"]}},req:[] },

  { name:"slack_send_message", desc:"Send a message to Slack", props:{channel:{type:"string",desc:"Channel ID or #name"},text:{type:"string"},thread_ts:{type:"string"}},req:["channel","text"] },
  { name:"slack_list_channels", desc:"List accessible channels", props:{types:{type:"string"}},req:[] },
  { name:"slack_list_users", desc:"List workspace users", props:{include_deleted:{type:"boolean"}},req:[] },
  { name:"slack_get_history", desc:"Get channel message history", props:{channel:{type:"string"},limit:{type:"number"}},req:["channel"] },
  { name:"slack_search", desc:"Search messages and files", props:{query:{type:"string"},sort:{type:"string",enum:["score","timestamp"]}},req:["query"] },
  { name:"slack_upload_file", desc:"Upload a file to a channel", props:{channel:{type:"string"},filepath:{type:"string"},title:{type:"string"}},req:["channel","filepath"] },
  { name:"slack_add_reaction", desc:"Add emoji reaction", props:{channel:{type:"string"},timestamp:{type:"string"},name:{type:"string"}},req:["channel","timestamp","name"] },
  { name:"slack_create_channel", desc:"Create a channel", props:{name:{type:"string"},is_private:{type:"boolean"}},req:["name"] },

  { name:"jira_search", desc:"Search issues with JQL", props:{jql:{type:"string"},maxResults:{type:"number"}},req:["jql"] },
  { name:"jira_get_issue", desc:"Get issue details", props:{key:{type:"string"}},req:["key"] },
  { name:"jira_create_issue", desc:"Create an issue", props:{project:{type:"string"},type:{type:"string",enum:["Bug","Task","Story","Epic"]},summary:{type:"string"},priority:{type:"string",enum:["Highest","High","Medium","Low","Lowest"]}},req:["project","type","summary"] },
  { name:"jira_update_issue", desc:"Update an issue", props:{key:{type:"string"},summary:{type:"string"},status:{type:"string"},assignee:{type:"string"}},req:["key"] },
  { name:"jira_add_comment", desc:"Add comment to issue", props:{key:{type:"string"},body:{type:"string"}},req:["key","body"] },
  { name:"jira_list_projects", desc:"List accessible projects", props:{},req:[] },
  { name:"jira_get_sprints", desc:"Get sprint info", props:{boardId:{type:"number"},state:{type:"string",enum:["active","future","closed"]}},req:["boardId"] },

  { name:"redis_get", desc:"Get key value", props:{key:{type:"string"}},req:["key"] },
  { name:"redis_set", desc:"Set key-value pair", props:{key:{type:"string"},value:{type:"string"},ttl:{type:"number"}},req:["key","value"] },
  { name:"redis_del", desc:"Delete keys", props:{keys:{type:"array",items:{type:"string"}}},req:["keys"] },
  { name:"redis_expire", desc:"Set key expiry", props:{key:{type:"string"},seconds:{type:"number"}},req:["key","seconds"] },
  { name:"redis_keys", desc:"Find keys by pattern", props:{pattern:{type:"string"}},req:["pattern"] },
  { name:"redis_exists", desc:"Check if key exists", props:{key:{type:"string"}},req:["key"] },
  { name:"redis_incr", desc:"Increment counter", props:{key:{type:"string"},amount:{type:"number"}},req:["key"] },
  { name:"redis_hget", desc:"Get hash field", props:{key:{type:"string"},field:{type:"string"}},req:["key","field"] },
  { name:"redis_hset", desc:"Set hash field", props:{key:{type:"string"},field:{type:"string"},value:{type:"string"}},req:["key","field","value"] },
  { name:"redis_lpush", desc:"Push to list left", props:{key:{type:"string"},values:{type:"array",items:{type:"string"}}},req:["key","values"] },
  { name:"redis_lrange", desc:"Get list range", props:{key:{type:"string"},start:{type:"number"},stop:{type:"number"}},req:["key","start","stop"] },
  { name:"redis_llen", desc:"Get list length", props:{key:{type:"string"}},req:["key"] },
];

const GROUPS = ["fs","postgres","slack","jira","redis"];
function toolsInGroup(g) { return ALL.filter(t=>t.name.startsWith(g+"_")); }

// ── Build tool schemas ─────────────────────────────────────────

function oaiTool(t) {
  return { type:"function", function:{ name:t.name, description:t.desc, parameters:{ type:"object", properties:t.props, required:t.req } } };
}
const flatTools = ALL.map(oaiTool);

// Merged (current MCPico): one tool per group, command field for help/exec
function mergedGroupTool(g) {
  const tools = toolsInGroup(g);
  return {
    type:"function", function:{
      name:g,
      description:`${g} operations (${tools.length} subcommands): ${tools.map(t=>t.name.split("_").pop()).join(", ")}`,
      parameters:{ type:"object", properties:{ command:{ type:"string", description:`"help" to list all subcommands, or "<subcommand> {params}" to execute. Example: "read_file {\\"path\\":\\"/tmp/x\\"}"` } }, required:["command"] }
    }
  };
}

// Split (improved): separate help_<group> for discovery + <group> for execution
function splitHelpTool(g) {
  const tools = toolsInGroup(g);
  return {
    type:"function", function:{
      name:`help_${g}`,
      description:`List all available ${g} subcommands with their parameters`,
      parameters:{ type:"object", properties:{}, required:[] }
    }
  };
}
function splitExecTool(g) {
  const tools = toolsInGroup(g);
  return {
    type:"function", function:{
      name: g,
      description: `${g} operations. Call help_${g} first to see available subcommands. Then call ${g} with: subcommand="${g}_<operation>" plus the required parameters.`,
      parameters:{ type:"object", properties:{ subcommand:{ type:"string", description:`The ${g} operation to run, e.g. "${g}_read_file" or "${g}_query"` }, params:{ type:"object", description:"Parameters for the subcommand as a JSON object" } }, required:["subcommand"] }
    }
  };
}

const mergedTools = GROUPS.map(mergedGroupTool);
const splitTools = GROUPS.flatMap(g => [splitHelpTool(g), splitExecTool(g)]);

// ── Simulate tool results ──────────────────────────────────────

function helpText(g) {
  const tools = toolsInGroup(g);
  return `Available ${g} subcommands:\n${tools.map(t => `  ${t.name}: ${t.desc}\n  Parameters: ${JSON.stringify(t.props)}`).join("\n")}`;
}

function execResult(toolName, args) {
  const results = {
    fs_read_file: `Contents of ${args.path || args.params?.path}: {"status":"active","version":"1.0"}`,
    fs_write_file: `Written to ${args.path || args.params?.path}`,
    fs_search: `Found: /tmp/docs/README.md (2026-06-01), /tmp/docs/notes.md (2026-06-15), /tmp/docs/new.md (2026-06-21)`,
    fs_list_directory: `/tmp/docs/\n  README.md\n  notes.md\n  new.md`,
    postgres_query: `Query result: ${args.sql || args.params?.sql} → [{"count": 42}]`,
    slack_send_message: `Message sent to ${args.channel || args.params?.channel}`,
    redis_get: "cached_value",
    redis_set: "OK",
  };
  return results[toolName] || `Executed ${toolName}`;
}

// ── LLM call ───────────────────────────────────────────────────

async function call(messages, tools) {
  const resp = await fetch(OMLX, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,messages,tools,max_tokens:256,temperature:0})
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ── Run one mode ───────────────────────────────────────────────

async function runMode(task, tools, mode) {
  const msgs = [{role:"user",content:task.msg}];
  let totalTokens=0, toolCalls=0, helpCalls=0, calls=[];
  const maxTurns = 8;

  for (let turn=0; turn<maxTurns; turn++) {
    const r = await call(msgs, tools);
    totalTokens += r.usage?.total_tokens || 0;
    const msg = r.choices[0].message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Task done — check success
      const allFound = task.want.every(w => calls.includes(w));
      return { mode, taskId:task.id, success:allFound, totalTokens, toolCalls, helpCalls, calls, finalText:msg.content };
    }

    // Process tool calls
    const tcResults = [];
    for (const tc of msg.tool_calls) {
      toolCalls++;
      const fn = tc.function;
      const args = JSON.parse(fn.arguments || "{}");

      let result;
      if (fn.name.startsWith("help_")) {
        helpCalls++;
        const g = fn.name.replace("help_","");
        calls.push("help_"+g);
        result = helpText(g);
      } else if (args.command === "help" || args.command === "" || args.command === fn.name) {
        helpCalls++;
        calls.push("help_"+fn.name);
        result = helpText(fn.name);
      } else if (mode === "merged") {
        // Parse command: "subcommand {params}" or just "subcommand"
        const cmd = args.command || "";
        const sp = cmd.indexOf(" ");
        const sub = sp > 0 ? cmd.slice(0,sp) : cmd;
        const subargs = sp > 0 ? (()=>{ try{return JSON.parse(cmd.slice(sp+1))}catch{return{}} })() : {};
        calls.push(sub);
        result = execResult(sub, subargs);
      } else {
        // Split mode: fn.name is the group, subcommand is explicit
        const sub = args.subcommand || fn.name;
        calls.push(sub);
        const subargs = args.params || args;
        result = execResult(sub, subargs);
      }
      tcResults.push({ tc, result });
    }

    msgs.push({role:"assistant",content:null,tool_calls:msg.tool_calls});
    for (const tr of tcResults) {
      msgs.push({role:"tool",tool_call_id:tr.tc.id,content:tr.result});
    }
  }

  // Hit max turns
  const allFound = task.want.every(w => calls.includes(w));
  return { mode, taskId:task.id, success:allFound, totalTokens, toolCalls, helpCalls, calls };
}

// ── Progress ───────────────────────────────────────────────────

const SYMBOLS = { flat:"·", merged:"M", split:"S" };
function ok(v) { return v ? "✓" : "✗"; }

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const modes = [
    ["flat", flatTools],
    ["merged", mergedTools],
    ["split", splitTools],
  ];

  console.log("Model:", MODEL);
  console.log("Comparing 3 tool layouts: Flat (45 tools) | Merged (5 group tools) | Split (5 help + 5 exec)");
  console.log("");

  const results = [];

  for (const task of TASKS) {
    process.stdout.write(`${task.id}: `);
    const row = { task: task.id };

    for (const [mode, tools] of modes) {
      const r = await runMode(task, tools, mode);
      results.push(r);
      row[mode] = r;
      process.stdout.write(`${SYMBOLS[mode]} ${String(r.totalTokens).padEnd(6)}t ${String(r.toolCalls).padEnd(2)}c ${ok(r.success)}  `);
    }
    console.log("");
  }

  // Summary
  console.log("\n── SUMMARY ──");
  console.log(`{"task":15} {"flat":>10} {"merged":>10} {"split":>10}`);

  for (const task of TASKS) {
    const tr = results.filter(r => r.taskId === task.id);
    const f = tr.find(r=>r.mode==="flat"), m=tr.find(r=>r.mode==="merged"), s=tr.find(r=>r.mode==="split");
    console.log(`${task.id.padEnd(15)} ${ok(f.success).padStart(1)} ${String(f.totalTokens).padStart(6)}t ${ok(m.success)} ${String(m.totalTokens).padStart(6)}t ${ok(s.success)} ${String(s.totalTokens).padStart(6)}t`);
  }
  console.log("");

  const flatTotal = results.filter(r=>r.mode==="flat").reduce((s,r)=>s+r.totalTokens,0);
  const mergedTotal = results.filter(r=>r.mode==="merged").reduce((s,r)=>s+r.totalTokens,0);
  const splitTotal = results.filter(r=>r.mode==="split").reduce((s,r)=>s+r.totalTokens,0);
  const flatOk = results.filter(r=>r.mode==="flat").filter(r=>r.success).length;
  const mergedOk = results.filter(r=>r.mode==="merged").filter(r=>r.success).length;
  const splitOk = results.filter(r=>r.mode==="split").filter(r=>r.success).length;

  console.log(`${"TOTAL".padEnd(15)} ${flatOk}/${TASKS.length} ${String(flatTotal).padStart(6)}t ${mergedOk}/${TASKS.length} ${String(mergedTotal).padStart(6)}t ${splitOk}/${TASKS.length} ${String(splitTotal).padStart(6)}t`);
  console.log("");
  console.log(`Flat → Merged:  -${Math.round((1-mergedTotal/flatTotal)*100)}% tokens, success ${flatOk}→${mergedOk}/${TASKS.length}`);
  console.log(`Flat → Split:   -${Math.round((1-splitTotal/flatTotal)*100)}% tokens, success ${flatOk}→${splitOk}/${TASKS.length}`);

  // Show call traces
  console.log("\n── CALL TRACES ──");
  for (const r of results) {
    console.log(`  ${r.mode.padEnd(7)} ${r.taskId.padEnd(12)} ${ok(r.success)} ${r.calls.join(" → ")}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
