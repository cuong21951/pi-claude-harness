export type Style = { fg: (role: string, text: string) => string; bold: (text: string) => string };

const ELBOW = "  ⎿  ";
const INDENT = "    ";
const EXPANDED_MAX = 20;

// ponytail: Claude Code 2.1.260 shows a running command as a blinking grey dot + its description and
// "⎿ $ cmd" under it; once finished the block is one grey line. Errors keep the red row.
export function runningLine(intent: string, blink: boolean, s: Style): string {
	return (blink ? s.fg("muted", "● ") : "  ") + intent;
}

export function doneLine(intent: string, s: Style): string {
	return s.fg("muted", `Ran ${intent}`);
}

export function commandLine(command: string, s: Style): string {
	return s.fg("muted", `${ELBOW}$ ${command.split("\n")[0]}`);
}

// ponytail: null draws nothing; ctrl+o brings the output back with the first line and "… +N lines".
export function resultLines(output: string, exitCode: number | null, expanded: boolean, truncated: boolean, s: Style): string[] | null {
	const lines = output.replace(/\n$/, "").split("\n");
	const first = lines.find((line) => line.trim()) ?? "";
	const failedStatus = exitCode === 0 || exitCode === null ? "" : `✗ exit ${exitCode} `;
	const elbow = s.fg("muted", ELBOW);
	if (expanded) {
		const shown = lines.slice(0, EXPANDED_MAX).map((line) => s.fg("muted", INDENT + line));
		const more = lines.length > EXPANDED_MAX ? [s.fg("muted", `${INDENT}… +${lines.length - EXPANDED_MAX} lines`)] : [];
		return [elbow + s.fg(failedStatus ? "error" : "muted", failedStatus + (truncated ? "[truncated] " : "")), ...shown, ...more];
	}
	if (!failedStatus) return null;
	const hidden = lines.length - 1;
	const hint = hidden > 0 ? s.fg("muted", ` … +${hidden} lines (ctrl+o to expand)`) : "";
	return [elbow + s.fg("error", failedStatus + first + (truncated ? " [truncated]" : "")) + hint];
}

if (process.env.INTENT_TOOLS_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const plain: Style = { fg: (_r, t) => t, bold: (t) => t };
	const tagged: Style = { fg: (r, t) => `<${r}>${t}</${r}>`, bold: (t) => t };
	check(runningLine("Check git status", true, tagged) === "<muted>● </muted>Check git status", "running: grey dot, plain intent");
	check(runningLine("Check git status", false, plain) === "  Check git status", "blink off keeps the column");
	check(doneLine("Check git status", tagged) === "<muted>Ran Check git status</muted>", "finished command is one grey line");
	check(commandLine("git status\nmore", tagged) === "<muted>  ⎿  $ git status</muted>", "command shown under the elbow while running");
	check(resultLines("only\n", 0, false, false, plain) === null, "successful collapsed result draws nothing");
	check(resultLines("boom", 1, false, false, plain)![0] === "  ⎿  ✗ exit 1 boom", "failed exit stays visible");
	check(resultLines("a\nb\nc", 2, false, false, plain)![0] === "  ⎿  ✗ exit 2 a … +2 lines (ctrl+o to expand)", "failure shows first line and count");
	check(resultLines("a\nb", 0, true, false, plain)!.join("|") === "  ⎿  |    a|    b", "expanded lists lines");
	check(resultLines("a\nb", 0, true, true, plain)![0] === "  ⎿  [truncated] ", "truncation flag when expanded");
	const many = Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n");
	check(resultLines(many, 0, true, false, plain)!.at(-1) === "    … +5 lines", "expanded caps at 20");
}
