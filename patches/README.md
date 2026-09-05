# patches

pi-mcp-adapter has no render hook, so its compact tool rows are patched in place to the Claude Code 2.1.261 look, measured live: a running call is a blinking grey dot + `Calling server…`, a finished call is one grey `Called server` line (Claude merges consecutive calls into `Called server 3 times`; pi cannot merge blocks, so it is one line per call), ctrl+o expands to `● server - tool (MCP)(args)` + the result rows. An error keeps its row: `● server - tool (MCP)(args)` + red `  ⎿  Error: …` (Claude's error look is unmeasured). The call block never prints in compact mode, so the JSON args dump that used to appear on errors is gone.

pi-deepseek-search owns the `web_search` tool and renders `web_search "query"` plus a 6-line dump of the answer, inside pi's default tool box. Patched to the Claude Code look (`● Web Search("query")` + `  └ Did 1 search in 12s (3 sources)`), with `renderShell: "self"` to drop the box and `durationMs` in the result details.

Apply (after `pi install` / `pi update`):

    git -c core.autocrlf=false apply --directory=npm/node_modules/pi-mcp-adapter patches/pi-mcp-adapter.patch
    git -c core.autocrlf=false apply --directory=npm/node_modules/pi-deepseek-search patches/pi-deepseek-search.patch

Verify:

    node patches/pi-mcp-adapter.selftest.ts
    node patches/pi-deepseek-search.selftest.ts

Note: pi-web-access also registers a `web_search` tool (rendered as `search "query"`). It loses the name to pi-deepseek-search, which registers on `session_start`, after every extension has loaded. Nothing renders that one, so it is left unpatched.
