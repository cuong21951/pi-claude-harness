import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: regular TUI mode has no alt screen, so on an empty transcript the prompt sits right under
// the header. This widget pads above the editor with the rows the terminal has left, so prompt and
// footer stay on the bottom rows like fullscreen; once the transcript outgrows the screen it pads 0.
// The total line count never shrinks because of it, so pi-tui's clearOnShrink full redraw is not triggered.
export function padRows(rows: number, used: number): number {
	return Math.max(0, rows - used);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("claude-bottom-input", (tui) => {
			let measuring = false;
			return {
				render(width: number) {
					if (measuring || tui.mode !== "regular") return [];
					measuring = true;
					try {
						return Array<string>(padRows(tui.terminal.rows, tui.render(width).length)).fill("");
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
	if (padRows(30, 12) !== 18 || padRows(30, 30) !== 0 || padRows(30, 45) !== 0) throw new Error("FAIL: padRows");
	console.log("ok - padRows");
}
