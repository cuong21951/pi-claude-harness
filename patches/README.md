# patches

pi-mcp-adapter has no render hook, so its compact tool rows are patched in place to the Claude Code look (`● server - tool (MCP)(args)` + `  └ result`).

Apply from `~/.pi/agent` (again after every `pi update`):

    git -c core.autocrlf=false apply --directory=npm/node_modules/pi-mcp-adapter <this repo>/patches/pi-mcp-adapter.patch

Verify: `node <this repo>/patches/pi-mcp-adapter.selftest.ts`
