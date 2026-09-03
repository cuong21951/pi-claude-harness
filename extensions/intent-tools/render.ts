export type Style = { fg: (role: string, text: string) => string; bold: (text: string) => string };

const ELBOW = "  └ ";
const INDENT = "    ";
const EXPANDED_MAX = 20;

export function callLine(intent: string, s: Style): string {
	return s.fg("toolTitle", s.bold("● ")) + s.fg("text", intent);
}

// ponytail: Claude Code shows the first output line and "… +N lines"; the whole output only on ctrl+o.
export function resultLines(output: string, exitCode: number | null, expanded: boolean, truncated: boolean): string[] {
	const lines = output.replace(/\n$/, "").split("\n");
	const first = lines.find((line) => line.trim()) ?? "";
	const status = exitCode === 0 || exitCode === null ? "" : `✗ exit ${exitCode} `;
	if (expanded) {
		const shown = lines.slice(0, EXPANDED_MAX).map((line) => INDENT + line);
		const more = lines.length > EXPANDED_MAX ? [`${INDENT}… +${lines.length - EXPANDED_MAX} lines`] : [];
		return [ELBOW + status + (truncated ? "[truncated] " : ""), ...shown, ...more];
	}
	const hidden = lines.length - 1;
	const hint = hidden > 0 ? ` … +${hidden} lines (ctrl+o to expand)` : "";
	return [ELBOW + status + first + (truncated ? " [truncated]" : "") + hint];
}

if (process.env.INTENT_TOOLS_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const plain: Style = { fg: (_r, t) => t, bold: (t) => t };
	check(callLine("Check git status", plain) === "● Check git status", "call line");
	check(resultLines("only\n", 0, false, false).join("|") === "  └ only", "single line, no hint");
	check(resultLines("a\nb\nc\n", 0, false, false).join("|") === "  └ a … +2 lines (ctrl+o to expand)", "collapsed shows first line and hint");
	check(resultLines("\n\nfirst real\nx", 0, false, false)[0] === "  └ first real … +3 lines (ctrl+o to expand)", "skips blank leading lines");
	check(resultLines("boom", 1, false, false)[0] === "  └ ✗ exit 1 boom", "failed exit leads with the code");
	check(resultLines("a\nb", 0, true, false).join("|") === "  └ |    a|    b", "expanded lists lines");
	check(resultLines("a\nb", 0, false, true)[0] === "  └ a [truncated] … +1 lines (ctrl+o to expand)", "truncation flag");
	const many = Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n");
	check(resultLines(many, 0, true, false).at(-1) === "    … +5 lines", "expanded caps at 20");
}
