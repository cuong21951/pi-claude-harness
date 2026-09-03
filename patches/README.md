# patches

pi-mcp-adapter has no render hook, so its compact tool rows are patched in place to the Claude Code look (`● server - tool (MCP)(args)` + `  └ result`).

pi-deepseek-search owns the `web_search` tool and renders `web_search "query"` plus a 6-line dump of the answer, inside pi's default tool box. Patched to the Claude Code look (`● Web Search("query")` + `  └ Did 1 search in 12s (3 sources)`), with `renderShell: "self"` to drop the box and `durationMs` in the result details.

Apply from `~/.pi/agent` (again after every `pi update`):

    git -c core.autocrlf=false apply --directory=npm/node_modules/pi-mcp-adapter <this repo>/patches/pi-mcp-adapter.patch
    git -c core.autocrlf=false apply --directory=npm/node_modules/pi-deepseek-search <this repo>/patches/pi-deepseek-search.patch

Verify:

    node <this repo>/patches/pi-mcp-adapter.selftest.ts
    node <this repo>/patches/pi-deepseek-search.selftest.ts

Note: pi-web-access also registers a `web_search` tool (rendered as `search "query"`). It loses the name to pi-deepseek-search, which registers on `session_start`, after every extension has loaded. Nothing renders that one, so it is left unpatched.
