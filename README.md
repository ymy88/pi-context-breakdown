# pi-context-breakdown

> `/context` for [pi](https://pi.dev) — see what your context window is made of: system prompt, tool declarations, MCP servers, messages, and how much room is left.

[![npm version](https://img.shields.io/npm/v/pi-context-breakdown)](https://www.npmjs.com/package/pi-context-breakdown)
[![license](https://img.shields.io/npm/l/pi-context-breakdown)](./LICENSE)

Claude Code has `/context`. pi doesn't — until now. One command prints a breakdown of the current context window into the transcript:

```
Context usage anthropic/claude-sonnet-4-5 · 68.2k / 200k tokens (34.1%)
■■■■■■■■■■■■····························

  ■ System prompt     11.1k  5.6%
  ■ System tools      10.6k  5.3%
  ■ MCP tools         31.4k 15.7%
  ■ Messages          15.1k  7.6%
  · Free space       131.8k 65.9%
```

Press `ctrl+o` to expand each group into its parts:

```
  ■ MCP tools         31.4k  3.1%
        linear_server (76 tools)       31.4k
  ■ System tools      10.4k  1.0%
        SubagentWorkflow                6.1k
        Agent                           2.6k
        codemode                         443
        edit                             332
```

## Install

```bash
pi install npm:pi-context-breakdown     # from npm
pi install git:github.com/ymy88/pi-context-breakdown
pi install ./path/to/pi-context-breakdown   # local checkout
```

Try it without installing anything:

```bash
pi -e npm:pi-context-breakdown
pi --extension ./index.ts
```

Or drop `index.ts` into `~/.pi/agent/extensions/` (user) or `.pi/extensions/` (project), then `/reload`.

## Usage

```
/context
```

The report is appended to the transcript as a session entry, so it stays there and can be reviewed later. **It is not sent to the model** — running `/context` does not change the context it measures.

In interactive mode `ctrl+o` toggles the expanded view for all entries. In RPC and print modes the command emits a one-line-per-group notification instead.

## What is in each group

| Group | What it measures |
|---|---|
| **System prompt** | the prompt sections the model currently has: preamble, rules, docs, skills, project context (`AGENTS.md` / `CLAUDE.md`), `cwd`, `APPEND_SYSTEM.md`, and any custom sections an extension adds |
| **System tools** | the declarations (`name` + description + JSON parameters) of the built-in and extension tools sent with the request |
| **MCP tools** | declarations for tools in an MCP server namespace, grouped per server with a tool count |
| **Messages** | user, assistant and tool-result messages in the active context, after compaction and context edits are applied |
| **Free space** | `contextWindow - used` |

## How the numbers are produced

- **Total and percentage** come from pi's own `ctx.getContextUsage()` — the same number pi shows in its footer (real usage from the last request plus estimated trailing messages).
- **The split** is estimated per item with pi's exported `estimateTokens`, then scaled onto that total, so the rows add up to the number pi reports.
- With no reported usage yet (fresh session, right after a compaction) the block is marked `— estimated` and shows the raw estimate.

Estimates are proportional, not exact: they tell you *where* the tokens go, not down to the token.

## Requirements

- pi `>= 1.3.0` (uses `ctx.getContextUsage()` and entry renderers)
- No dependencies. Nothing to build.

## Development

```bash
git clone git@github.com:ymy88/pi-context-breakdown.git
cd pi-context-breakdown
pi --extension ./index.ts    # loads the working copy, no install
```

## License

MIT © [ymy88](https://github.com/ymy88)
