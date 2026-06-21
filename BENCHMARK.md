# MCPico LLM Benchmark

Real-world comparison of three tool layout approaches with actual LLMs.

## Method

We define 3 realistic tasks across 5 MCP servers (filesystem, PostgreSQL, Slack, Jira, Redis — 45 total tools). Each task is run with three different tool layout strategies:

| Mode | Description | Tools exposed |
|---|---|---|
| **Flat** | Traditional MCP — all 45 tools exposed directly | 45 tools with full schemas |
| **Merged (v0.2.0)** | Old MCPico design — one group tool per server, `command` field doubles as help + execution | 5 group tools |
| **Split (v0.3.0)** | Current MCPico design — separate `help_<group>` discovery + `<group>` execution tools | 5 help + 5 exec = 10 tools |

Three tasks spanning different complexity levels:

1. **single** — "Read the contents of /tmp/config.json" → needs `fs_read_file`
2. **multi-cross** — "Run SELECT count(*) FROM users, then send the count to #general on Slack" → needs `postgres_query` + `slack_send_message`
3. **fs-complex** — "Find all .md files under /tmp/docs/, then read the newest one" → needs `fs_search` + `fs_read_file`

Measured: task success rate, total tokens consumed, number of tool calls.

## Results

### Qwen3.5-9B (9-billion parameter)

| Task | Flat | Merged | Split |
|---|---|---|---|
| single | ✓ 7,591t 1c | ✗ 1,761t 1c | ✓ 2,461t 1c |
| multi-cross | ✓ 11,509t 2c | ✗ 2,831t 2c | ✓ 7,767t 4c |
| fs-complex | ✗ 15,660t 5c | ✗ 8,614t 8c | ✗ 3,799t 2c |
| **TOTAL** | **2/3 34,760t** | **0/3 13,206t (-62%)** | **2/3 14,027t (-60%)** |

### Qwen3.6-35B (35-billion parameter MoE)

| Task | Flat | Merged | Split |
|---|---|---|---|
| single | ✓ 7,715t 1c | ✗ 1,081t 0c | ✓ 4,434t 2c |
| multi-cross | ✓ 11,697t 2c | ✗ 9,041t 8c | ✓ 6,750t 4c |
| fs-complex | ✗ 3,976t 0c | ✗ 1,082t 0c | ✗ 10,446t 7c |
| **TOTAL** | **2/3 23,388t** | **0/3 11,204t (-52%)** | **2/3 21,630t (-8%)** |

## Key Findings

### 1. Merged mode (v0.2.0) was broken for LLMs
The `command` field approach (one field for both help and execution) failed on **100% of tasks** across both models. Models couldn't reliably distinguish between discovery and execution when they shared the same interface. This finding drove the v0.3.0 redesign.

**Verdict: Merged `command` field approach is unworkable — split discovery and execution.**

### 2. Split mode (v0.3.0, current) matches flat success rate
The current split design (separate `help_<group>` + `<group>` tools) achieves the same 2/3 success rate as flat mode on both models. Models naturally use `help_postgres` to discover, then `postgres_query` to execute.

### 3. Token savings are significant on smaller models
The 9B model saves 60% tokens with the split design (14,027t vs 34,760t). The flat prompt is heavy because all 45 tool schemas are loaded into every request. The split design only loads tool schemas when the model explicitly requests help.

The 35B model shows more modest savings (8%) because its flat prompt tokenization is more efficient, and its split-mode help responses are more verbose.

### 4. Complex multi-step tasks fail on all modes
Task 3 (fs-complex) fails across all three modes on both models. This is a model reasoning limitation, not a tool layout issue. The models struggle with multi-step filesystem operations regardless of how tools are presented.

### 5. Call trace comparison (9B, multi-cross task)

```
Flat:    postgres_query → slack_send_message
Merged:  query → message                           (wrong tool names)
Split:   help_postgres → postgres_query → help_slack → slack_send_message
```

The split trace shows clean discovery-then-execution behavior. The merged trace shows the model guessing tool names without proper discovery.

## Running

```bash
# Requires oMLX running on localhost:21434
node benchmark/bench-v2.js          # Uses default model
MODEL=<name> node benchmark/bench-v2.js  # Override model
```
