# pi-claude-harness

A [pi](https://pi.dev) coding-agent setup that looks and behaves like Claude Code. One `pi install` gets the UI; one script gets the rest of the harness (tool permissions, cheap-model guard, auto-fallback, subagents, prompt chains, skills).

## What you get

**Claude Code look**

| Extension | Effect |
|---|---|
| `claude-header` | Cat mascot (blinks, wags, drops a heart while the header is on screen) + `pi vX`, model with effort and provider, cwd |
| `claude-tools` | read/write/edit/grep/find/ls render as `● Read(path)` / `  └ Read N lines`, `● Update(path)` + diff, `● Search(pattern: …)` |
| `intent-tools` | bash rows show the model's one-line intent as `● description` + first output line, `ctrl+o` to expand |
| `claude-messages` | `● ` before assistant paragraphs, `✻ Thinking…` label |
| `claude-working` | Claude's sparkle spinner `· ✢ * ✶ ✻ ✽` with a shimmer over the verb, elapsed time, tokens, `esc to interrupt` |
| `claude-footer` | One muted line: extension statuses · model · think level · ctx % · $cost · git branch |
| `claude-input` | Flat rules above and below with a `> ` prompt, exactly like Claude Code 2.1.259 |
| `claude-images` | `alt+v` pastes a clipboard image as an `[Image #N]` chip (Windows only; other platforms keep pi's `ctrl+v`) |
| `claude-mcp-render` | Drops the schema dump MCP tools append on validation errors |
| `themes/claude-dark` | Dark theme, Claude orange accents, daltonized diff colours |

**Harness**

| Piece | Effect |
|---|---|
| `extensions/pi-permission-system/config.json` | Config for [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages): yolo mode with a review log, credentials file denied |
| `cheap-models` + `cheap-models.json` | Only models under the price caps / allow list can run; an expensive pick is swapped back before the request goes out |
| `deepseek-guards` | Blocks image reads on text-only DeepSeek models, unbounded scans, busy-wait loops |
| `no-code-comments` | Rejects edits that add code comments (the `ponytail:` marker is allowed) |
| `rtk-bash` | Rewrites bash commands through [rtk](https://github.com/rtk-ai/rtk) when it is installed (60-90% less tool output); no-op without it |
| `api-balance` | OpenRouter / DeepSeek key balance in the footer, green/yellow/red |
| `auto-fallback.json` | Chain for [`pi-auto-fallback`](https://www.npmjs.com/package/pi-auto-fallback): GLM 5.3 Flash → DeepSeek V4 Flash on OpenRouter |
| `agents/` + `subagents.json` | scout / planner / worker / reviewer for [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents) |
| `prompts/` | `/implement`, `/implement-and-review`, `/scout-and-plan` chains |
| `skills/` | browser-tools (Windows-patched copy of badlogic's), frontend-design, run-research, search-youtube |
| `AGENTS.md` | Global rules: finish the job, verify before claiming, review method, taste rules, risky actions, model routing, output shape |
| `models.json` | OpenRouter entries for GLM 5.3 Flash and Muse Spark, plus an optional local OpenAI-compatible proxy provider (`commandcode`, delete it if you do not run one) |
| `keybindings.json` | `ctrl+p`/`ctrl+n` prompt history, `ctrl+alt+v` for pi's own image paste (frees `alt+v`) |

## Install

```sh
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/cuong21951/pi-claude-harness
node ~/.pi/agent/git/github.com/cuong21951/pi-claude-harness/scripts/install.mjs
```

`pi install` fetches this repo and registers its extensions, theme, skills and prompts. `install.mjs` copies the config files above into `~/.pi/agent` (never overwriting what is already there), runs `pi install` for each package in `settings.example.json` that is not installed yet, and adds the remaining settings keys only when missing.

Then put your OpenRouter key in `~/.pi/agent/auth.json` (or `OPENROUTER_API_KEY`) and start `pi`. Optional: `patches/pi-mcp-adapter.patch` restyles MCP tool rows, see `patches/README.md`.

Set `PI_CODING_AGENT_DIR` to install somewhere other than `~/.pi/agent`.

## Notes

- `tuiMode: regular` behaves like Claude Code (terminal owns scrollback and the mouse wheel). The cat animates only while the header is still on screen; once the transcript is taller than the terminal it freezes, because pi-tui answers any change above the viewport with a full redraw.
- The cheap-model guard exists because pi picks the first model of the provider list when `defaultModel` is unset, and on OpenRouter that is a frontier model. Keep `defaultModel` set.
- `rtk-bash` and `api-balance` are harmless without rtk / without keys.

## Test

```sh
node scripts/selftest.mjs
```

Runs every extension's self-check through the installed pi (set `PI_DIR` if pi is not the global npm install).

## Update

```sh
pi update --extensions
```

`install.mjs` can be run again after an update; it still never overwrites your files.
