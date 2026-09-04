import * as os from "node:os";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { doneLine, resultRows, type Row, runningLine, type Style, WRITE_TOOLS, writeCallLine } from "./format.ts";
import { blinkOn, dynamic, failed, finished, track } from "./rows.ts";

// ponytail: only the render slots change; execute, schema and prompt metadata are the built-in definition's.
const DEFINITIONS = {
	read: createReadToolDefinition,
	write: createWriteToolDefinition,
	edit: createEditToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
};

type Theme = { fg: (role: never, text: string) => string; bold: (text: string) => string };

function style(theme: Theme): Style {
	return { fg: (role, text) => theme.fg(role as never, text), bold: (text) => theme.bold(text), home: os.homedir() };
}

// ponytail: Claude's diff backgrounds, measured: removed 5f0000 with a d75f5f gutter, added 00005f with a
// 5fafd7 gutter, text ffffff on both, the colour running to the right edge. The theme has no roles for
// these, so they are painted here.
const ROW_PAINT: Record<Row["kind"], { fg: string; bg?: string; gutter?: string }> = {
	plain: { fg: "" },
	muted: { fg: "\x1b[38;2;148;148;148m" },
	context: { fg: "\x1b[38;2;255;255;255m" },
	removed: { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;95;0;0m", gutter: "\x1b[38;2;215;95;95m" },
	added: { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;0;0;95m", gutter: "\x1b[38;2;95;175;215m" },
};
const RESET = "\x1b[0m";
const GUTTER = /^( *\d+ [-+] )(.*)$/;

export function paintRow(row: Row, width: number): string {
	const p = ROW_PAINT[row.kind];
	const text = truncateToWidth(row.text, width);
	if (!p.bg) return p.fg + text + RESET;
	const m = text.match(GUTTER);
	const body = m ? p.gutter + m[1] + p.fg + m[2] : p.fg + text;
	return p.bg + body + " ".repeat(Math.max(0, width - visibleWidth(text))) + RESET;
}

function visibleWidth(text: string): number {
	return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export default function (pi: ExtensionAPI) {
	track(pi);
	for (const [tool, create] of Object.entries(DEFINITIONS)) {
		const original = create(process.cwd()) as any;
		pi.registerTool({
			...original,
			renderShell: "self",
			// ponytail: the finished grey line lives in the result row; the call row goes to zero lines so the
			// block is one line plus pi's own spacing, the closest pi allows to Claude's collapsed rows.
			renderCall(args: Record<string, unknown>, theme: Theme, context: { toolCallId?: string }) {
				const s = style(theme);
				if (WRITE_TOOLS.has(tool)) return dynamic((width) => [truncateToWidth(writeCallLine(tool, args, s), width)]);
				return dynamic((width) => (finished.has(context.toolCallId ?? "") ? [] : [truncateToWidth(runningLine(tool, args, blinkOn(), s), width)]));
			},
			renderResult(result: any, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: Theme, context: { args: Record<string, unknown>; isError?: boolean; toolCallId?: string }) {
				const text = result.content
					.filter((block: { type: string }) => block.type === "text")
					.map((block: { text?: string }) => block.text ?? "")
					.join("\n");
				// ponytail: pi reports a failed tool through the render context, not on the result.
				const isError = result.isError === true || context.isError === true || failed.has(context.toolCallId ?? "");
				const outcome = { text, isError, details: result.details };
				const view = { expanded, isPartial, hint: keyHint("app.tools.expand", "to expand") };
				const s = style(theme);
				const rows = resultRows(tool, context.args, outcome, view, s);
				const head = WRITE_TOOLS.has(tool) || isPartial ? [] : [doneLine(tool, context.args, s)];
				return dynamic((width) => [...head, ...(rows ? [rows.head, ...rows.rows.map((row) => paintRow(row, width))] : [])].map((line) => truncateToWidth(line, width)));
			},
		});
	}
}
