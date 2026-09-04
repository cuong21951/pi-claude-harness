import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

type Paint = (role: string, text: string) => string;

// ponytail: Claude Code prints "● high · /effort" in grey, right-aligned above the prompt rules.
// /effort is registered below so the hint is true for pi too.
export function effortLine(level: string, width: number, paint: Paint): string {
	const text = `● ${level || "off"} · /effort`;
	const pad = Math.max(0, width - text.length);
	return " ".repeat(pad) + paint("muted", text);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("claude-effort", (_tui, theme) => ({
			render(width: number) {
				return [effortLine(ctx.thinkingLevel ?? "off", width, (role, text) => theme.fg(role as never, text))];
			},
			invalidate() {},
		}));
	});

	pi.registerCommand("effort", {
		description: "Set the thinking effort (off, minimal, low, medium, high, xhigh, max)",
		handler: async (args, ctx) => {
			const wanted = args.trim().toLowerCase();
			const level = LEVELS.includes(wanted) ? wanted : ctx.hasUI ? await ctx.ui.select("Effort", LEVELS) : undefined;
			if (level) pi.setThinkingLevel(level as never);
		},
	});
}

if (process.env.CLAUDE_EFFORT_SELFTEST) {
	const plain: Paint = (_role, text) => text;
	const line = effortLine("high", 40, plain);
	if (line.length !== 40 || !line.endsWith("● high · /effort")) throw new Error("FAIL: right-aligned effort line");
	if (effortLine("", 20, plain).trim() !== "● off · /effort") throw new Error("FAIL: empty level reads off");
	if (effortLine("xhigh", 5, plain) !== "● xhigh · /effort") throw new Error("FAIL: narrow width never pads negative");
	console.log("ok - claude-effort");
}
