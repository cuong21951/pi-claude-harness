# pi-claude-harness

A [pi](https://pi.dev) coding-agent setup that looks and behaves like Claude Code. One `pi install` gets the UI; one script gets the rest of the harness (tool permissions, cheap-model guard, auto-fallback, subagents, prompt chains, skills).

## What you get

**Claude Code look**

| Extension | Effect |
|---|---|
| `claude-header` | Cat mascot (blinks, wags, drops a heart while the header is on screen) + `pi vX`, model with effort and provider, cwd |
| `claude-tools` | read/write/edit/grep/find/ls render as `● Read(path)` / `  └ Read N lines`, `● Update(path)` + diff, `● Search(pattern: …)`. A failed call shows `└ ✗ <first line>` in red |
| `intent-tools` | bash rows show the model's one-line intent as `● description` + first output line, `ctrl+o` to expand |
| `claude-messages` | `● ` before assistant paragraphs. With thinking hidden it leaves no placeholder line, the way Claude does |
| `claude-working` | Claude's sparkle spinner `· ✢ * ✶ ✻ ✽` with a shimmer over the verb, elapsed time, tokens, `esc to interrupt` |
| `claude-footer` | One muted line: extension statuses · model · think level · ctx % · $cost · git branch (the voice status takes the mode row's right-hand slot) |
| `claude-input` | Flat rules above and below with a `> ` prompt, exactly like Claude Code 2.1.259 |
| `claude-bottom-input` | In `regular` TUI mode, pads above the editor so the prompt and footer sit on the bottom rows like fullscreen, and holds the frame at its high-water line count so a collapsing block (the `?` card, a streamed tool result) never leaves blank rows under the footer |
| `claude-images` | `alt+v` pastes a clipboard image as an `[Image #N]` chip (Windows only; other platforms keep pi's `ctrl+v`) |
| `claude-mcp-render` | Drops the schema dump MCP tools append on validation errors |
| `claude-modes` | `shift+tab` cycles plan / accept edits / bypass, shown on Claude's mode row in the footer. Plan blocks writes and allows only read-only bash; accept edits applies edits without asking but confirms a side-effecting bash; bypass asks nothing. It offers plan mode when a message reads like a planning request, and asks "Plan ready. Proceed?" when a plan-mode turn ends |
| `claude-effort` | `● high · /effort` right-aligned above the prompt; `/effort [level]` sets the thinking level |
| `claude-help` | `?` on an empty prompt toggles the shortcut card, any key hides it |
| `claude-keys` | Double-tap esc clears the prompt, `ctrl+s` stashes and restores it |
| `voice` | Claude Code 2.1.261's voice dictation, local: hold Space (`/voice hold`) or tap Space on an empty prompt (`/voice tap`), `hold space to speak` / `listening…` / `● REC · tap to send` / pulsing `Voice: processing…` in the footer slot, dimmed live transcript at the cursor, the cursor becomes a mic-level bar. Needs `ffmpeg` on PATH and `py -3.12 -m pip install faster-whisper` (CUDA wheels optional); nothing leaves the machine |
| `herdr-state` | Reports session and working/idle state to the herdr multiplexer (`HERDR_ENV=1` only) |
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

- Colours measured on screen, not guessed: Claude Code 2.1.260 in `dark-daltonized` was driven in a pseudo-terminal and every run of characters read back with its colour. Tool dot `5fafff`, grey `949494`, separators `585858`, model `87afd7`, green `87af87`, spinner `ffaf5f` with `ffd787` shimmer, diff backgrounds `5f0000` / `00005f`, user message `3a3a3a`. The theme carries these values.
- Tool rows behave like Claude's. A running tool is a blinking grey dot plus "Reading a.txt" or the bash description, with `⎿ $ cmd` under it. A finished read-only tool (read, search, list, bash) collapses to one grey line: `Read a.txt`, `Ran Check git status`; ctrl+o brings the elbow and the output back, and a failed command keeps its red row. Write and Update keep the blue dot, a grey `⎿`, bold counts, and show the written lines or the diff with line numbers and Claude's backgrounds. Claude merges consecutive read-only tools into "Read 1 file, ran 2 shell commands"; pi keeps one block per tool, so it is one grey line per tool.
- A turn ends with Claude's grey `✻ Churned for 13s · done 12:58 AM`, the spinner verb in the past tense.
- No coloured block behind a tool row, because Claude never draws one.
- Modes on `shift+tab`, with the plan-mode offer when you ask for a plan, and the "Plan ready. Proceed?" question (accept edits / bypass / keep planning) when a plan-mode turn ends. Accepting continues the same conversation.
- Footer rows: line one is `[PONYTAIL] · model · think · ctx · $cost · branch · statuses`, line two is Claude's mode row (`⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ bypass permissions on`) with `? for shortcuts` on the right. Overflow drops the trailing statuses first, so ctx and cost survive at 120 columns.
- Prompt: `❯ `, `● high · /effort` right-aligned above it (`/effort` sets the thinking level), `?` card on an empty prompt. Claude's placeholder tip was dropped on request.
- Keys: double-tap esc clears the prompt, ctrl+s stashes it, ctrl+shift+t is the thinking toggle. `\` + enter for a newline is not possible (pi has no key chords), use shift+enter.
- Startup: set `PI_SKIP_VERSION_CHECK=1` in your `pi` wrapper and the update box is gone. The ponytail and MCP notices are printed by their packages and stay.
- Done notification via `pi-notify`; `herdr-state` reports the session and working/idle state to the herdr multiplexer like Claude Code's hook (no-op outside herdr).
- Subagent progress: the live widget (spinner per agent, tick or cross when it lands) and the fleet list are both on.

**Not matched yet**

- Markdown inside messages. Link, inline-code and heading colours are still pi's own; Claude's were never measured, so they were left alone rather than guessed.
- `auto` is enforced by this harness, not by the permission extension, which exposes no runtime API for a narrower auto-approve. If your own permission policy also asks for bash, you will see two prompts.
- Yolo takes effect from your next message, not mid-turn, because the permission extension re-reads its config at the start of each turn.
- Only the bypass colour of the mode row was measured (256-colour 210). Plan and accept edits use the nearest theme roles.
- Rewind (esc esc restoring files) does not exist; `/tree` and `/fork` restore the conversation only.
- `auto` judges a bash command by an allowlist that looks through `rtk`, `rtk proxy`, `command`, `time` and `nice`. Anything outside the allowlist raises a confirm, so an unusual but harmless command will still ask.
- Assistant body text is the terminal's default foreground, not `#ffffff`. pi's markdown renderer paints headings, links and code from the theme but leaves paragraph text uncoloured, and the theme has no key for it, so matching Claude's pure white would take a patch to pi itself.
- The header cat keeps its own orange (`d97757`); Claude's logo is `d78787`. The `warning` role was deliberately left on the cat's colour.
- Hidden thinking blocks between tool calls leave pi's own blank lines (up to three); the tool rows themselves add none.

## Testing

Renderers and mode logic are pure functions with their own self-checks, so `node scripts/selftest.mjs` covers them without a model.

Anything that only appears in a real terminal is tested by driving pi inside a pseudo-terminal with `pywinpty` and reading the screen back with `pyte`, which reports each run of characters with its colour. Two ways to use it:

- Replay a saved session with `--session <absolute path>` and no model at all. This is how row colours, diff colours, the error row and the thinking placeholder are checked. Session files are trees, so chain each `toolResult` to the previous one; two results sharing a parent are sibling branches and only one renders.
- Drive a live session by sending keystrokes, for what needs a model to call a tool: plan mode refusing a write, auto mode confirming a command, the plan-mode offer.

Two traps worth knowing. Session paths must be absolute, because pi is spawned with the home folder as its working directory and a relative path silently starts an empty session. And point `CLAUDE_MODES_PERMISSION_CONFIG` at a throwaway file, or the mode cycle will rewrite your real permission config.

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
