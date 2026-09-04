import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CYCLE_HINT, gate, MODE_LINE, type Mode, NOTICE, nextMode, PROCEED_CHOICES, proceedMode, wantsPlan } from "./modes.ts";

const PERMISSION_CONFIG =
	process.env.CLAUDE_MODES_PERMISSION_CONFIG ?? join(getAgentDir(), "extensions", "pi-permission-system", "config.json");

function readYolo(): boolean {
	try {
		return JSON.parse(readFileSync(PERMISSION_CONFIG, "utf8")).yoloMode === true;
	} catch {
		return false;
	}
}

function writeYolo(on: boolean): void {
	try {
		const config = JSON.parse(readFileSync(PERMISSION_CONFIG, "utf8"));
		if (config.yoloMode === on) return;
		writeFileSync(PERMISSION_CONFIG, `${JSON.stringify({ ...config, yoloMode: on }, null, 2)}\n`);
	} catch {
		// leave the operator's config alone if it cannot be parsed
	}
}

// ponytail: the status text is already painted here so claude-footer can print it as-is on its own row.
function modeRow(mode: Mode, ctx: any): string {
	const line = MODE_LINE[mode];
	return ctx.ui.theme.fg(line.role, line.text) + ctx.ui.theme.fg("muted", CYCLE_HINT);
}

export default function (pi: ExtensionAPI) {
	let mode: Mode = "auto";
	let offerDeclined = false;

	// ponytail: the permission extension re-reads its config at every turn start, so writing the
	// file is enough; reload() exists only on command contexts anyway.
	function apply(target: Mode, ctx: any) {
		mode = target;
		writeYolo(mode === "yolo");
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("modes", modeRow(mode, ctx));
		ctx.ui.notify(NOTICE[mode], "info");
	}

	pi.on("session_start", async (_event, ctx) => {
		mode = readYolo() ? "yolo" : "auto";
		if (ctx.hasUI) ctx.ui.setStatus("modes", modeRow(mode, ctx));
	});

	pi.registerShortcut("shift+tab", {
		description: "Cycle mode (plan / auto / yolo)",
		handler: async (ctx) => apply(nextMode(mode), ctx),
	});

	pi.registerCommand("mode", {
		description: "Cycle mode (plan / auto / yolo)",
		handler: async (_args, ctx) => apply(nextMode(mode), ctx),
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (mode === "plan" || offerDeclined || !ctx.hasUI) return;
		if (!wantsPlan(String(event.prompt ?? ""))) return;
		const yes = await ctx.ui.confirm("Plan mode?", "This reads like a planning request. Switch to plan mode (read-only) first?");
		if (yes) apply("plan", ctx);
		else offerDeclined = true;
	});

	// ponytail: Claude Code's ExitPlanMode question, asked when a plan-mode turn ends. Accepting switches
	// the mode and continues the same conversation, so the plan on screen is the one that gets built.
	// It is asked off the event so the other agent_end handlers (the spinner) finish first.
	pi.on("agent_end", (event, ctx) => {
		if (mode !== "plan" || !ctx.hasUI || (event.messages?.length ?? 0) === 0) return;
		setImmediate(async () => {
			const target = proceedMode(await ctx.ui.select("Plan ready. Proceed?", [...PROCEED_CHOICES]));
			if (!target) return;
			apply(target, ctx);
			pi.sendMessage(
				{ customType: "claude-modes-proceed", content: "The plan above is accepted. Implement it now.", display: false },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		});
	});

	pi.on("tool_call", async (event, ctx) => {
		const command = String((event.input as { command?: unknown } | undefined)?.command ?? "");
		const decision = gate(mode, event.toolName, command);
		if (decision.action === "allow") return;
		if (decision.action === "block") return { block: true, reason: decision.reason };
		if (!ctx.hasUI) return;
		const ok = await ctx.ui.confirm("Run this command?", decision.question);
		if (!ok) return { block: true, reason: "Declined. Press shift+tab for yolo mode to stop being asked." };
	});
}
