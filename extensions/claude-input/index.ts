import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANSI = /\x1b\[[0-9;]*m/g;
// ponytail: pi marks the hardware cursor with an APC sequence; it is invisible but must survive.
const INVISIBLE = /\x1b\[[0-9;]*m|\x1b_[^\x07]*\x07/g;
const PROMPT = "❯ ";
const PLACEHOLDER = 'Try "how does <filepath> work?"';

type Paint = (text: string) => string;

// ponytail: Claude Code (2.1.260) draws a flat rule above and below the text, a "❯ " prompt and a dim
// placeholder while the prompt is empty, no side borders. pi's editor already draws the rules, so the inner editor is rendered
// PROMPT.length columns narrower, its rules are stretched back to full width and its text rows
// get the prompt. Rows after the bottom rule are the autocomplete list and stay untouched.
const isRule = (line: string) => line.replace(ANSI, "").startsWith("─");

export function promptLines(lines: string[], paint: Paint, dim: Paint = (text) => text): string[] {
	const out: string[] = [];
	let rules = 0;
	lines.forEach((line, i) => {
		if (rules === 2) {
			out.push(line);
			return;
		}
		if (isRule(line)) {
			out.push(line + paint("─".repeat(PROMPT.length)));
			rules++;
			return;
		}
		const first = out.length === 1;
		const plain = line.replace(INVISIBLE, "");
		const empty = first && plain.trim() === "" && plain.length > PLACEHOLDER.length && isRule(lines[i + 1] ?? "");
		out.push((first ? PROMPT : " ".repeat(PROMPT.length)) + (empty ? line.trimEnd() + dim(PLACEHOLDER) : line));
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
			const dim: Paint = (text) => ctx.ui.theme.fg("dim", text);
			editor.render = (width: number) => promptLines(render(width - PROMPT.length), paint, dim);
			return editor;
		});
	});
}
