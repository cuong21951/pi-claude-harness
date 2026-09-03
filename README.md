# pi-claude-harness

A [pi](https://pi.dev) coding-agent setup that looks and behaves like Claude Code. One `pi install` gets the UI; one script gets the rest of the harness (tool permissions, cheap-model guard, auto-fallback, subagents, prompt chains, skills).

## What you get

**Claude Code look**

| Extension | Effect |
|---|---|
| `claude-header` | Cat mascot (blinks, wags, drops a heart while the header is on screen) + `pi vX`, model with effort and provider, cwd |
| `claude-tools` | read/write/edit/grep/find/ls render as `● Read(path)` / `  └ Read N lines`, `● Update(path)` + diff, `● Search(pattern: …)` |
| `intent-tools` | bash rows show the model's one-line intent as `● description` + first output line, `ctrl+o` to expand |
| `claude-messages` | `● ` before assistant paragraphs, `✻ Thought` label on collapsed thinking blocks |
| `claude-working` | Claude's sparkle spinner `· ✢ * ✶ ✻ ✽` with a shimmer over the verb, elapsed time, tokens, `esc to interrupt` |
| `claude-footer` | One muted line: extension statuses · model · think level · ctx % · $cost · git branch |
| `claude-input` | Flat rules above and below with a `> ` prompt, exactly like Claude Code 2.1.259 |
| `claude-bottom-input` | In `regular` TUI mode, pads above the editor so the prompt and footer sit on the bottom rows like fullscreen (0 rows once the transcript overflows; never triggers a full redraw) |
| `claude-images` | `alt+v` pastes a clipboard image as an `[Image #N]` chip (Windows only; other platforms keep pi's `ctrl+v`) |
| `claude-mcp-render` | Drops the schema dump MCP tools append on validation errors |
| `claude-modes` | `shift+tab` cycles normal / plan / yolo with a `[PLAN]` badge, and offers plan mode when a message reads like a planning request |
| `themes/claude-dark` | Palette taken from Claude Code's own `dark-daltonized` theme: white text, `#3399ff` tool dot, `#af87ff` skill dot, `#ff6666` error, blue/red diffs, tool backgrounds painted out so no row sits in a coloured box |

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
| `models.json` | OpenRouter entries for GLM 5.3 Flash and Muse Spark with pricing and thinking-level maps |
| `keybindings.json` | `ctrl+p`/`ctrl+n` prompt history, `ctrl+alt+v` for pi's own image paste (frees `alt+v`), `ctrl+alt+t` for the thinking-level cycle (frees `shift+tab` for the mode cycle) |

## Claude parity

What the harness matches today, and what it does not, so the next pass starts from a ledger instead of a guess.

**Matched**

- Row shape everywhere: `● Label(args)` on the call line, `  └ summary` on the result, `ctrl+o` to expand. File tools, bash, skills, MCP and web search all agree.
- Colours measured, not guessed. Claude's palette was read out of its own binary and the rendered rows were sampled pixel by pixel from a side-by-side capture. The theme targets `dark-daltonized`, which is what a colour-blind-safe Claude install uses.
- The dot carries meaning: blue for a tool, purple for a skill, red only on failure.
- No coloured block behind a tool row, because Claude never draws one.
- Modes on `shift+tab`, with the plan-mode offer when you ask for a plan.
- Subagent progress: the live widget (spinner per agent, tick or cross when it lands) and the fleet list are both on.

**Not matched yet**

- Markdown inside messages. Link, inline-code and heading colours are still pi's own; Claude's were never measured, so they were left alone rather than guessed.
- No `accept edits` mode. Claude cycles through one; the permission extension exposes no runtime API for a narrower auto-approve, so the cycle stops at yolo.
- Yolo is not instant. It writes the permission config and reloads extensions, because that extension reads its config once at load.
- Plan mode has two owners. `claude-modes` enforces it, while pi's bundled `plan-mode` example still ships its own `/plan` and `/todos` on `ctrl+alt+p`.
- The collapsed thinking line says `✻ Thought` with no duration; Claude says `Thought for Ns`.
- The header cat keeps its own orange. The `warning` role was deliberately left on `#d97757` so the cat does not change.

## Install

```sh
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/cuong21951/pi-claude-harness
node ~/.pi/agent/git/github.com/cuong21951/pi-claude-harness/scripts/install.mjs
```

`pi install` fetches this repo and registers its extensions, theme, skills and prompts. `install.mjs` copies the config files above into `~/.pi/agent` (never overwriting what is already there), runs `pi install` for each package in `settings.example.json` that is not installed yet, and adds the remaining settings keys only when missing.

Then put your OpenRouter key in `~/.pi/agent/auth.json` (or `OPENROUTER_API_KEY`) and start `pi`. Optional: `patches/pi-mcp-adapter.patch` restyles MCP tool rows and `patches/pi-deepseek-search.patch` restyles web-search rows, see `patches/README.md`.

Set `PI_CODING_AGENT_DIR` to install somewhere other than `~/.pi/agent`.

## Notes

- `tuiMode: regular` is the default: the terminal owns scrollback and the mouse wheel like Claude Code, and `claude-bottom-input` keeps the prompt on the bottom rows. `fullscreen` (alt screen) always animates the cat, but under multiplexers that do not forward mouse events (herdr on Windows) the wheel becomes Up/Down there. In `regular` the cat only animates while the header is still on screen, because pi-tui answers any change above the viewport with a full redraw. Wrap `pi` in a shell function that prints `ESC[2J ESC[3J ESC[H` first: pi does not clear the screen at startup, so relaunches stack the previous session in the pane.
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
