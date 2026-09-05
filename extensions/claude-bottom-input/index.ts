import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: regular TUI mode has no alt screen, so on an empty transcript the prompt sits right under
// the header. This widget pads above the editor with the rows the terminal has left, so prompt and
// footer stay on the bottom rows like fullscreen; once the transcript outgrows the screen it pads 0.
// The pad also holds the frame at its high-water line count: when a block collapses (the ? card, a
// streamed tool result) pi-tui would otherwise leave the freed rows blank under the footer.
export function padRows(rows: number, used: number, floor: number = 0): number {
	return Math.max(0, Math.max(rows, floor) - used);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("claude-bottom-input", (tui) => {
			let measuring = false;
			let floor = 0;
			let lastRows = 0;
			return {
				render(width: number) {
					if (measuring || tui.mode !== "regular") return [];
					measuring = true;
					try {
						const rows = tui.terminal.rows;
						if (rows !== lastRows) {
							lastRows = rows;
							floor = 0;
						}
						const used = tui.render(width).length;
						const pad = padRows(rows, used, floor);
						floor = used + pad;
						return Array<string>(pad).fill("");
					} finally {
						measuring = false;
					}
				},
				invalidate() {},
			};
		});
	});
}

if (process.env.CLAUDE_BOTTOM_INPUT_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(padRows(30, 12) === 18 && padRows(30, 30) === 0 && padRows(30, 45) === 0, "pads the screen, never past it");
	check(padRows(30, 40, 46) === 6, "a frame that shrank by 6 lines keeps its 46-line height");
	check(padRows(30, 50, 46) === 0, "a frame that grew past the floor pads nothing");
	check(padRows(40, 12, 30) === 28, "a taller terminal wins over a smaller floor");
	console.log("\nAll claude-bottom-input checks passed.");
}
