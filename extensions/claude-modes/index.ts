import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BADGE, bashAllowedInPlan, type Mode, nextMode, toolBlockedInPlan, wantsPlan } from "./modes.ts";

const PERMISSION_CONFIG =
	process.env.CLAUDE_MODES_PERMISSION_CONFIG ?? join(getAgentDir(), "extensions", "pi-permission-system", "config.json");

function readYolo(): boolean {
	try {
		return JSON.parse(readFileSync(PERMISSION_CONFIG, "utf8")).yoloMode === true;
	} catch {
		return false;
	}
}

function writeYolo(on: boolean): boolean {
	try {
		const config = JSON.parse(readFileSync(PERMISSION_CONFIG, "utf8"));
		if (config.yoloMode === on) return false;
		writeFileSync(PERMISSION_CONFIG, `${JSON.stringify({ ...config, yoloMode: on }, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	let mode: Mode = "normal";
	let offerDeclined = false;

	// ponytail: the permission extension reads its config once at load, so a live yolo flip needs a reload.
	async function apply(target: Mode, ctx: any) {
		const wasYolo = mode === "yolo";
		mode = target;
		if (ctx.hasUI) ctx.ui.setStatus("modes", BADGE[mode]);
		const needsReload = writeYolo(mode === "yolo");
		if (ctx.hasUI) {
			ctx.ui.notify(
				mode === "plan"
					? "Plan mode. Writes are blocked, bash is read-only."
					: mode === "yolo"
						? "Yolo mode. Permission prompts are off."
						: "Normal mode.",
				"info",
			);
		}
		if (needsReload && (mode === "yolo" || wasYolo)) await ctx.reload();
	}

	pi.on("session_start", async (_event, ctx) => {
		mode = readYolo() ? "yolo" : "normal";
		if (ctx.hasUI) ctx.ui.setStatus("modes", BADGE[mode]);
	});

	pi.registerShortcut("shift+tab", {
		description: "Cycle mode (normal / plan / yolo)",
		handler: async (ctx) => apply(nextMode(mode), ctx),
	});

	pi.registerCommand("mode", {
		description: "Cycle mode (normal / plan / yolo)",
		handler: async (_args, ctx) => apply(nextMode(mode), ctx),
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (mode !== "normal" || offerDeclined || !ctx.hasUI) return;
		if (!wantsPlan(String(event.prompt ?? ""))) return;
		const yes = await ctx.ui.confirm("Plan mode?", "This reads like a planning request. Switch to plan mode (read-only) first?");
		if (yes) await apply("plan", ctx);
		else offerDeclined = true;
	});

	pi.on("tool_call", async (event) => {
		if (mode !== "plan") return;
		if (toolBlockedInPlan(event.toolName)) {
			return { block: true, reason: `Plan mode: ${event.toolName} is blocked. Cycle out of plan mode with shift+tab to make changes.` };
		}
		if (event.toolName === "bash" && !bashAllowedInPlan(String((event.input as { command?: unknown }).command ?? ""))) {
			return { block: true, reason: "Plan mode: only read-only bash is allowed. Cycle out of plan mode with shift+tab to run this." };
		}
	});
}
