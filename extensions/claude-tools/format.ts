export type Paint = (role: string, text: string) => string;
export interface Style {
	fg: Paint;
	bold: (text: string) => string;
	home: string;
}

export interface ToolOutcome {
	text: string;
	isError: boolean;
	details: unknown;
}

export interface ResultView {
	expanded: boolean;
	isPartial: boolean;
	hint: string;
}

export type RowKind = "plain" | "muted" | "context" | "added" | "removed";
export interface Row {
	kind: RowKind;
	text: string;
}

const LABEL: Record<string, string> = { write: "Write", edit: "Update" };
const VERB: Record<string, string> = { read: "Reading", grep: "Searching", find: "Searching", ls: "Listing" };
const PAST: Record<string, string> = { read: "Read", grep: "Searched", find: "Searched", ls: "Listed" };
export const WRITE_TOOLS = new Set(["write", "edit"]);
const ELBOW = "  ⎿  ";
const WRITE_PREVIEW_LINES = 10;
const COLLAPSED_DIFF_LINES = 20;
const EXPANDED_OUTPUT_LINES = 20;

function shortPath(value: unknown, home: string): string {
	const path = typeof value === "string" ? value : "";
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

// ponytail: Claude names the thing, not the tool: "Reading a.txt", "Searched "foo"".
export function target(tool: string, args: Record<string, unknown>, home: string): string {
	switch (tool) {
		case "grep":
		case "find":
			return `"${String(args.pattern ?? "")}"`;
		default:
			return shortPath(args.path, home) || ".";
	}
}

export function runningLine(tool: string, args: Record<string, unknown>, blink: boolean, s: Style): string {
	return (blink ? s.fg("muted", "● ") : "  ") + `${VERB[tool] ?? "Running"} ${target(tool, args, s.home)}`;
}

export function doneLine(tool: string, args: Record<string, unknown>, s: Style): string {
	return s.fg("muted", `${PAST[tool] ?? "Ran"} ${target(tool, args, s.home)}`);
}

export function writeCallLine(tool: string, args: Record<string, unknown>, s: Style): string {
	return s.fg("borderAccent", "● ") + s.bold(LABEL[tool] ?? tool) + `(${shortPath(args.path, s.home)})`;
}

function lineCount(text: string): number {
	const body = text.replace(/\n$/, "");
	return body === "" || /^(No |\(empty)/.test(body) ? 0 : body.split("\n").length;
}

function plural(n: number, one: string, many = `${one}s`, bold: (t: string) => string = (t) => t): string {
	return `${bold(String(n))} ${n === 1 ? one : many}`;
}

function diffLines(details: unknown): string[] {
	const diff = (details as { diff?: unknown } | undefined)?.diff;
	return typeof diff === "string" && diff !== "" ? diff.split("\n") : [];
}

export function summary(tool: string, args: Record<string, unknown>, outcome: ToolOutcome, s: Style): string {
	switch (tool) {
		case "read":
			return `Read ${plural(lineCount(outcome.text), "line")}`;
		case "write":
			return `Wrote ${plural(lineCount(String(args.content ?? "")), "line", undefined, s.bold)} to ${s.bold(shortPath(args.path, s.home))}`;
		case "edit": {
			const lines = diffLines(outcome.details);
			const added = lines.filter((line) => line.startsWith("+")).length;
			const removed = lines.filter((line) => line.startsWith("-")).length;
			// ponytail: a missing diff is not a zero-change edit; saying so would misreport the tool.
			if (added === 0 && removed === 0) return `Updated ${s.bold(shortPath(args.path, s.home))}`;
			return `Added ${plural(added, "line", undefined, s.bold)}, removed ${plural(removed, "line", undefined, s.bold)}`;
		}
		case "grep":
			return `Found ${plural(lineCount(outcome.text), "line")}`;
		case "find":
			return `Found ${plural(lineCount(outcome.text), "file")}`;
		default:
			return `Listed ${plural(lineCount(outcome.text), "entry", "entries")}`;
	}
}

const DIFF_LINE = /^([ +-])\s*(\d+) (.*)$/;

// ponytail: Claude's diff rows are " 2 - two" / " 2 + 2" / " 1   one" with the line number first; pi's
// diff string has the sign first, so it is re-shaped here. Lines that are not diff rows (the "..." gap)
// pass through muted.
export function diffRows(lines: string[]): Row[] {
	const parsed = lines.map((line) => line.match(DIFF_LINE));
	const width = Math.max(1, ...parsed.map((m) => (m ? m[2].length : 0)));
	return lines.map((line, i) => {
		const m = parsed[i];
		if (!m) return { kind: "muted", text: line };
		const [, sign, num, text] = m;
		const kind: RowKind = sign === "+" ? "added" : sign === "-" ? "removed" : "context";
		return { kind, text: ` ${num.padStart(width)} ${sign === " " ? " " : sign} ${text}` };
	});
}

export function contentRows(content: string): Row[] {
	const lines = content.replace(/\n$/, "").split("\n");
	const width = String(lines.length).length;
	return lines.map((text, i) => ({ kind: "context", text: ` ${String(i + 1).padStart(width)} ${text}` }));
}

function more(hidden: number, hint: string): Row[] {
	return hidden > 0 ? [{ kind: "muted", text: `… +${hidden} lines (${hint})` }] : [];
}

function writeBody(tool: string, args: Record<string, unknown>, outcome: ToolOutcome, view: ResultView): Row[] {
	if (tool === "edit") {
		const all = diffRows(diffLines(outcome.details));
		const shown = view.expanded ? all : all.slice(0, COLLAPSED_DIFF_LINES);
		return [...shown, ...more(all.length - shown.length, view.hint)];
	}
	const all = contentRows(String(args.content ?? ""));
	const shown = view.expanded ? all : all.slice(0, WRITE_PREVIEW_LINES);
	return [...shown, ...more(all.length - shown.length, view.hint)];
}

function outputRows(text: string, hint: string): Row[] {
	const lines = text.replace(/\n$/, "").split("\n");
	const shown = lines.slice(0, EXPANDED_OUTPUT_LINES);
	return [...shown.map((line) => ({ kind: "muted" as RowKind, text: `    ${line}` })), ...more(lines.length - shown.length, hint)];
}

export interface Result {
	head: string;
	rows: Row[];
}

// ponytail: null means the row draws nothing. A finished read-only tool is only its grey call line, like
// Claude's collapsed "Read 1 file"; ctrl+o brings the elbow and the output back.
export function resultRows(tool: string, args: Record<string, unknown>, outcome: ToolOutcome, view: ResultView, s: Style): Result | null {
	const elbow = s.fg("muted", ELBOW);
	const write = WRITE_TOOLS.has(tool);
	if (view.isPartial) return { head: elbow + s.fg("muted", write ? "…" : target(tool, args, s.home)), rows: [] };
	if (outcome.isError) {
		const [first, ...rest] = outcome.text.split("\n");
		const rows = view.expanded ? rest.map((line) => ({ kind: "muted" as RowKind, text: `    ${s.fg("error", line)}` })) : [];
		return { head: elbow + s.fg("error", `✗ ${first}`), rows };
	}
	if (write) return { head: elbow + summary(tool, args, outcome, s), rows: writeBody(tool, args, outcome, view) };
	if (!view.expanded) return null;
	return { head: elbow + summary(tool, args, outcome, s), rows: outputRows(outcome.text, view.hint) };
}

if (process.env.CLAUDE_TOOLS_SELFTEST) {
	const plain: Style = { fg: (_role, text) => text, bold: (text) => text, home: "/home/me" };
	const tagged: Style = { fg: (role, text) => `<${role}>${text}</${role}>`, bold: (text) => `<b>${text}</b>`, home: "/home/me" };
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const view = (expanded = false): ResultView => ({ expanded, isPartial: false, hint: "ctrl+o to expand" });
	const ok = (text: string, details?: unknown): ToolOutcome => ({ text, isError: false, details });

	check(runningLine("read", { path: "/home/me/a.ts" }, true, tagged) === "<muted>● </muted>Reading ~/a.ts", "running read: grey dot, plain text");
	check(runningLine("read", { path: "a.ts" }, false, plain) === "  Reading a.ts", "blink off hides the dot, keeps the column");
	check(runningLine("grep", { pattern: "foo" }, true, plain) === '● Searching "foo"', "running grep names the pattern");
	check(doneLine("read", { path: "/home/me/a.ts" }, tagged) === "<muted>Read ~/a.ts</muted>", "finished read is one grey line without a dot");
	check(doneLine("ls", {}, plain) === "Listed .", "ls defaults to cwd");
	check(doneLine("find", { pattern: "**/*.ts" }, plain) === 'Searched "**/*.ts"', "find is a search");
	check(writeCallLine("edit", { path: "/home/me/x.ts" }, tagged) === "<borderAccent>● </borderAccent><b>Update</b>(~/x.ts)", "update call: blue dot, bold label, plain path");
	check(writeCallLine("write", { path: "n.ts" }, plain) === "● Write(n.ts)", "write call");

	check(resultRows("read", { path: "a" }, ok("l1\nl2\nl3\n"), view(), plain) === null, "collapsed read result draws nothing");
	const expanded = resultRows("read", { path: "a" }, ok("l1\nl2"), view(true), plain)!;
	check(expanded.head === "  ⎿  Read 2 lines" && expanded.rows.map((r) => r.text).join("|") === "    l1|    l2", "expanded read shows elbow, summary and output");
	check(resultRows("read", { path: "a" }, ok(""), { ...view(), isPartial: true }, tagged)!.head === "<muted>  ⎿  </muted><muted>a</muted>", "partial read shows the target under the elbow");
	check(resultRows("read", {}, { text: "ENOENT\nmore", isError: true, details: undefined }, view(), tagged)!.head === "<muted>  ⎿  </muted><error>✗ ENOENT</error>", "error stays visible in red");

	const wrote = resultRows("write", { path: "/home/me/n.ts", content: "a\nb" }, ok("Successfully wrote"), view(), tagged)!;
	check(wrote.head === "<muted>  ⎿  </muted>Wrote <b>2</b> lines to <b>~/n.ts</b>", "write summary bolds the count and the path");
	check(wrote.rows.map((r) => `${r.kind}:${r.text}`).join("|") === "context: 1 a|context: 2 b", "write preview numbers the content");
	const long = Array.from({ length: 14 }, (_, i) => `l${i + 1}`).join("\n");
	const preview = resultRows("write", { path: "n.ts", content: long }, ok(""), view(), plain)!.rows;
	check(preview.length === 11 && preview[10].text === "… +4 lines (ctrl+o to expand)" && preview[9].text === " 10 l10", "write shows ten lines then the rest as a count");
	check(resultRows("write", { path: "n.ts", content: long }, ok(""), view(true), plain)!.rows.length === 14, "expanded write shows everything");

	const diff = " 1 one\n-2 two\n+2 2\n 3 three";
	const updated = resultRows("edit", { path: "x.ts" }, ok("done", { diff }), view(), tagged)!;
	check(updated.head === "<muted>  ⎿  </muted>Added <b>1</b> line, removed <b>1</b> line", "update summary matches Claude's wording");
	check(
		updated.rows.map((r) => `${r.kind}:${r.text}`).join("|") === "context: 1   one|removed: 2 - two|added: 2 + 2|context: 3   three",
		"diff rows: number first, sign column, Claude's spacing",
	);
	check(diffRows(["-  9 a", "+ 10 b", "     ..."]).map((r) => r.text).join("|") === "  9 - a| 10 + b|     ...", "numbers right-align to the widest, gaps pass through");
	check(resultRows("edit", { path: "x.ts" }, ok("done", {}), view(), plain)!.head === "  ⎿  Updated x.ts", "edit without diff details omits counts");
	const longDiff = Array.from({ length: 25 }, (_, i) => `+${i} x`).join("\n");
	const rows = resultRows("edit", { path: "x" }, ok("", { diff: longDiff }), view(), plain)!.rows;
	check(rows.length === 21 && rows[20].text === "… +5 lines (ctrl+o to expand)", "long diff collapses with a count");
	console.log("\nAll claude-tools checks passed.");
}
