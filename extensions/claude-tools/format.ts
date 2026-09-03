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

const LABEL: Record<string, string> = { read: "Read", write: "Write", edit: "Update", grep: "Search", find: "Search", ls: "List" };
const COLLAPSED_DIFF_LINES = 20;
const INDENT = "    ";

function shortPath(value: unknown, home: string): string {
	const path = typeof value === "string" ? value : "";
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function namedArgs(args: Record<string, unknown>, keys: string[], home: string): string {
	return keys
		.filter((key) => args[key] !== undefined && args[key] !== "")
		.map((key) => {
			const value = args[key];
			if (typeof value !== "string") return `${key}: ${value}`;
			return `${key}: "${key === "path" ? shortPath(value, home) : value}"`;
		})
		.join(", ");
}

export function callArgs(tool: string, args: Record<string, unknown>, home: string): string {
	switch (tool) {
		case "grep":
			return namedArgs(args, ["pattern", "path", "glob"], home);
		case "find":
			return namedArgs(args, ["pattern", "path"], home);
		case "read":
			return [shortPath(args.path, home), namedArgs(args, ["offset", "limit"], home)].filter(Boolean).join(", ");
		default:
			return shortPath(args.path, home) || ".";
	}
}

export function callLine(tool: string, args: Record<string, unknown>, s: Style): string {
	return s.fg("success", s.bold("● ")) + s.fg("toolTitle", s.bold(LABEL[tool] ?? tool)) + s.fg("toolTitle", `(${callArgs(tool, args ?? {}, s.home)})`);
}

function lineCount(text: string): number {
	const body = text.replace(/\n$/, "");
	return body === "" || /^(No |\(empty)/.test(body) ? 0 : body.split("\n").length;
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

function diffLines(details: unknown): string[] {
	const diff = (details as { diff?: unknown } | undefined)?.diff;
	return typeof diff === "string" && diff !== "" ? diff.split("\n") : [];
}

export function summary(tool: string, args: Record<string, unknown>, outcome: ToolOutcome, home: string): string {
	switch (tool) {
		case "read":
			return `Read ${plural(lineCount(outcome.text), "line")}`;
		case "write":
			return `Wrote ${plural(lineCount(String(args.content ?? "")), "line")} to ${shortPath(args.path, home)}`;
		case "edit": {
			const lines = diffLines(outcome.details);
			const added = lines.filter((line) => line.startsWith("+")).length;
			const removed = lines.filter((line) => line.startsWith("-")).length;
			const path = shortPath(args.path, home);
			// ponytail: a missing diff is not a zero-change edit; saying so would misreport the tool.
			if (added === 0 && removed === 0) return `Updated ${path}`;
			return `Updated ${path} with ${plural(added, "addition")} and ${plural(removed, "removal")}`;
		}
		case "grep":
			return `Found ${plural(lineCount(outcome.text), "line")}`;
		case "find":
			return `Found ${plural(lineCount(outcome.text), "file")}`;
		default:
			return `Listed ${plural(lineCount(outcome.text), "entry", "entries")}`;
	}
}

function paintDiff(line: string, s: Style): string {
	if (line.startsWith("+")) return s.fg("toolDiffAdded", line);
	if (line.startsWith("-")) return s.fg("toolDiffRemoved", line);
	return s.fg("toolDiffContext", line);
}

function bodyLines(tool: string, args: Record<string, unknown>, outcome: ToolOutcome, expanded: boolean, s: Style): { lines: string[]; hidden: number } {
	if (tool === "edit") {
		const all = diffLines(outcome.details).map((line) => paintDiff(line, s));
		const shown = expanded ? all : all.slice(0, COLLAPSED_DIFF_LINES);
		return { lines: shown, hidden: all.length - shown.length };
	}
	const text = tool === "write" ? String(args.content ?? "") : outcome.text;
	const count = lineCount(text);
	if (!expanded) return { lines: [], hidden: count };
	return { lines: text.replace(/\n$/, "").split("\n").map((line) => s.fg("toolOutput", line)), hidden: 0 };
}

export function resultText(tool: string, args: Record<string, unknown>, outcome: ToolOutcome, view: ResultView, s: Style): string {
	const elbow = s.fg("toolTitle", "  └ ");
	if (view.isPartial) return elbow + s.fg("dim", "…");
	if (outcome.isError) {
		const [first, ...rest] = outcome.text.split("\n");
		const tail = view.expanded ? rest.map((line) => `\n${INDENT}${s.fg("error", line)}`).join("") : "";
		return elbow + s.fg("error", `✗ ${first}`) + tail;
	}
	const { lines, hidden } = bodyLines(tool, args ?? {}, outcome, view.expanded, s);
	let head = elbow + s.fg("toolTitle", summary(tool, args ?? {}, outcome, s.home));
	if (hidden > 0) head += s.fg("dim", ` (${view.hint})`);
	return [head, ...lines.map((line) => INDENT + line)].join("\n");
}

if (process.env.CLAUDE_TOOLS_SELFTEST) {
	const plain: Style = { fg: (_role, text) => text, bold: (text) => text, home: "/home/me" };
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const view = (expanded = false): ResultView => ({ expanded, isPartial: false, hint: "ctrl+o to expand" });
	check(callLine("read", { path: "/home/me/a.ts" }, plain) === "● Read(~/a.ts)", "read call shortens home");
	check(callLine("read", { path: "a.ts", offset: 10, limit: 20 }, plain) === "● Read(a.ts, offset: 10, limit: 20)", "read range");
	check(callLine("grep", { pattern: "foo", path: "/home/me/src", glob: "*.ts" }, plain) === '● Search(pattern: "foo", path: "~/src", glob: "*.ts")', "grep call");
	check(callLine("find", { pattern: "**/*.ts" }, plain) === '● Search(pattern: "**/*.ts")', "find call omits missing path");
	check(callLine("ls", {}, plain) === "● List(.)", "ls defaults to cwd");
	check(callLine("edit", { path: "x.ts" }, plain) === "● Update(x.ts)", "edit is Update");
	const ok = (text: string, details?: unknown): ToolOutcome => ({ text, isError: false, details });
	check(resultText("read", { path: "a" }, ok("l1\nl2\nl3\n"), view(), plain) === "  └ Read 3 lines (ctrl+o to expand)", "read summary counts lines");
	check(resultText("read", { path: "a" }, ok("only"), view(), plain) === "  └ Read 1 line (ctrl+o to expand)", "singular line");
	check(resultText("read", { path: "a" }, ok("l1\nl2"), view(true), plain) === "  └ Read 2 lines\n    l1\n    l2", "expanded shows output");
	check(resultText("grep", {}, ok("No matches found"), view(), plain) === "  └ Found 0 lines", "grep zero result has no hint");
	check(resultText("ls", {}, ok("(empty directory)"), view(), plain) === "  └ Listed 0 entries", "ls empty directory");
	check(resultText("write", { path: "/home/me/n.ts", content: "a\nb" }, ok("Successfully wrote"), view(), plain) === "  └ Wrote 2 lines to ~/n.ts (ctrl+o to expand)", "write counts content");
	check(resultText("write", { path: "n.ts", content: "a\nb" }, ok("Successfully wrote"), view(true), plain) === "  └ Wrote 2 lines to n.ts\n    a\n    b", "write expands to the written content");
	const diff = "+1 a\n-2 b\n 3 c\n+4 d";
	check(
		resultText("edit", { path: "x.ts" }, ok("done", { diff }), view(), plain) === "  └ Updated x.ts with 2 additions and 1 removal\n    +1 a\n    -2 b\n     3 c\n    +4 d",
		"edit summary and diff always shown",
	);
	check(resultText("edit", { path: "x.ts" }, ok("done", {}), view(), plain) === "  └ Updated x.ts", "edit without diff details omits counts");
	const longDiff = Array.from({ length: 25 }, (_, i) => `+${i} x`).join("\n");
	check(resultText("edit", { path: "x" }, ok("", { diff: longDiff }), view(), plain).startsWith("  └ Updated x with 25 additions and 0 removals (ctrl+o to expand)"), "long diff collapses with hint");
	check(resultText("read", {}, { text: "ENOENT\nmore", isError: true, details: undefined }, view(), plain) === "  └ ✗ ENOENT", "error shows first line");
	check(resultText("read", {}, ok(""), { ...view(), isPartial: true }, plain) === "  └ …", "partial");
}
