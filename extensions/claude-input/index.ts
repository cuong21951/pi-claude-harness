import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANSI = /\x1b\[[0-9;]*m/g;
const PROMPT = "❯ ";

type Paint = (text: string) => string;

// ponytail: Claude Code (2.1.260) draws a flat rule above and below the text and a "❯ " prompt, no side
// borders (its placeholder tip was dropped on request). pi's editor already draws the rules, so the inner editor is rendered
// PROMPT.length columns narrower, its rules are stretched back to full width and its text rows
// get the prompt. Rows after the bottom rule are the autocomplete list and stay untouched.
const isRule = (line: string) => line.replace(ANSI, "").startsWith("─");

export function promptLines(lines: string[], paint: Paint): string[] {
	const out: string[] = [];
	let rules = 0;
	lines.forEach((line) => {
		if (rules === 2) {
			out.push(line);
			return;
		}
		if (isRule(line)) {
			out.push(line + paint("─".repeat(PROMPT.length)));
			rules++;
			return;
		}
		out.push((out.length === 1 ? PROMPT : " ".repeat(PROMPT.length)) + line);
	});
	return out;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previous ? previous(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings);
			const paint: Paint = (text) => theme.borderColor(text);
			const render = editor.render.bind(editor);
			editor.render = (width: number) => promptLines(render(width - PROMPT.length), paint);
			return editor;
		});
	});
}
