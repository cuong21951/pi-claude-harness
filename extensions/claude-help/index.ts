import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: Claude Code's "?" card, three columns, with pi's real keys in place of Claude's.
const CARD: string[][] = [
	["! for shell mode", "double tap esc to clear input", "ctrl + z to undo"],
	["/ for commands", "shift + tab to cycle modes", "alt + v to paste images"],
	["@ for file paths", "ctrl + o for verbose output", "alt + p to switch model"],
	["/effort for thinking", "shift + enter for newline", "ctrl + s to stash prompt"],
	["", "ctrl + p / ctrl + n for history", "ctrl + g to edit in $EDITOR"],
	["", "", "/hotkeys to customize"],
];
const COLUMNS = [24, 35];

type Paint = (role: string, text: string) => string;

export function cardLines(paint: Paint): string[] {
	return CARD.map((row) => {
		let line = "  ";
		row.forEach((cell, i) => {
			line += paint("muted", cell);
			if (i < COLUMNS.length) line += " ".repeat(Math.max(1, COLUMNS[i] - cell.length));
		});
		return line.trimEnd();
	});
}

// ponytail: "?" only toggles the card while the prompt is empty, so typing a question mark still works.
export function togglesCard(data: string, editorText: string): boolean {
	return data === "?" && editorText.trim() === "";
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		let shown = false;
		const show = (on: boolean) => {
			shown = on;
			ctx.ui.setWidget("claude-help", on ? cardLines((role, text) => ctx.ui.theme.fg(role as never, text)) : undefined);
		};
		ctx.ui.onTerminalInput((data: string) => {
			if (togglesCard(data, ctx.ui.getEditorText())) {
				show(!shown);
				return { consume: true };
			}
			if (shown) show(false);
			return undefined;
		});
	});
}

if (process.env.CLAUDE_HELP_SELFTEST) {
	const lines = cardLines((_role, text) => text);
	if (lines.length !== 6 || !lines[0].startsWith("  ! for shell mode")) throw new Error("FAIL: card shape");
	if (lines[0].indexOf("double tap esc") !== 2 + 24 || lines[0].indexOf("ctrl + z") !== 2 + 24 + 35) throw new Error("FAIL: column alignment");
	if (!togglesCard("?", "") || togglesCard("?", "what?") || togglesCard("a", "")) throw new Error("FAIL: toggle rule");
	console.log(lines.join("\n"));
	console.log("ok - claude-help");
}
