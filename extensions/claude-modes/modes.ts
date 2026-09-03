export const MODES = ["plan", "auto", "yolo"] as const;
export type Mode = (typeof MODES)[number];

export const BADGE: Record<Mode, string> = {
	plan: "[PLAN]",
	auto: "[AUTO]",
	// ponytail: the permission extension already badges yolo; a second one would just repeat it.
	yolo: "",
};

export const NOTICE: Record<Mode, string> = {
	plan: "Plan mode. Writes are blocked, bash is read-only.",
	auto: "Auto mode. Edits apply without asking, bash asks first.",
	yolo: "Yolo mode. Nothing asks.",
};

export function nextMode(mode: Mode): Mode {
	return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

const PLAN_INTENT =
	/(^|\s)(plan|planning|kế hoạch|ke hoach|lên kế hoạch)\b|\b(how should we|what'?s the approach|design a|draft a plan|propose a plan)\b/i;

const PLAN_INTENT_EXCLUDED = /\bplan\s*(mode)?\s*(off|out)\b|\bno plan\b|\bexit plan\b/i;

export function wantsPlan(prompt: string): boolean {
	if (PLAN_INTENT_EXCLUDED.test(prompt)) return false;
	return PLAN_INTENT.test(prompt);
}

const READ_ONLY_BASH =
	/^\s*(ls|pwd|echo|cat|head|tail|wc|file|stat|which|whoami|date|env|printenv|grep|rg|find|fd|tree|diff|du|df|node --version|npm ls|npm view|py(thon)? --version|git (status|log|diff|show|branch|remote|config --get|rev-parse|ls-files))\b/;

// ponytail: rtk-bash rewrites every command to `rtk <cmd>`, so the allowlist must see through it.
const WRAPPERS = /^\s*(rtk(\s+proxy)?|command|time|nice(\s+-n\s*-?\d+)?)\s+/;

function unwrap(segment: string): string {
	let out = segment;
	for (let i = 0; i < 3 && WRAPPERS.test(out); i++) out = out.replace(WRAPPERS, "");
	return out;
}

export function bashIsReadOnly(command: string): boolean {
	const segments = command.split(/&&|\|\||;|\|/);
	return segments.every((segment) => segment.trim() === "" || READ_ONLY_BASH.test(unwrap(segment)));
}

const WRITE_TOOLS = new Set(["write", "edit"]);

export type Gate = { action: "allow" } | { action: "block"; reason: string } | { action: "ask"; question: string };

export function gate(mode: Mode, toolName: string, command: string): Gate {
	if (mode === "yolo") return { action: "allow" };
	if (mode === "plan") {
		if (WRITE_TOOLS.has(toolName)) {
			return { action: "block", reason: `Plan mode: ${toolName} is blocked. Press shift+tab to leave plan mode.` };
		}
		if (toolName === "bash" && !bashIsReadOnly(command)) {
			return { action: "block", reason: "Plan mode: only read-only bash is allowed. Press shift+tab to leave plan mode." };
		}
		return { action: "allow" };
	}
	if (toolName === "bash" && !bashIsReadOnly(command)) {
		return { action: "ask", question: command };
	}
	return { action: "allow" };
}

if (process.env.CLAUDE_MODES_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(nextMode("plan") === "auto", "plan cycles to auto");
	check(nextMode("auto") === "yolo", "auto cycles to yolo");
	check(nextMode("yolo") === "plan", "yolo wraps to plan");

	check(wantsPlan("make a plan for the migration"), "plan intent");
	check(wantsPlan("lên kế hoạch cho việc này"), "vietnamese plan intent");
	check(wantsPlan("How should we structure this?"), "approach phrasing");
	check(!wantsPlan("turn plan mode off"), "leaving plan is not an offer");
	check(!wantsPlan("fix the failing test"), "ordinary work is not an offer");
	check(!wantsPlan("deploy the planet renderer"), "substring does not match");

	check(bashIsReadOnly("git status --short"), "read-only bash recognised");
	check(bashIsReadOnly("ls -la | grep ts"), "pipeline of read-only parts");
	check(!bashIsReadOnly("rm -rf build"), "destructive bash not read-only");
	check(!bashIsReadOnly("git status && rm x"), "mixed pipeline not read-only");

	check(bashIsReadOnly("rtk git status"), "rtk wrapper sees through to git status");
	check(bashIsReadOnly("rtk proxy cat file.txt"), "rtk proxy wrapper");
	check(!bashIsReadOnly("rtk rm -rf build"), "rtk wrapper does not launder a destructive command");
	check(gate("plan", "bash", "rtk git status").action === "allow", "plan allows rtk-wrapped read-only bash");
	check(gate("auto", "bash", "rtk git status").action === "allow", "auto does not ask for rtk-wrapped read-only bash");
	check(gate("plan", "write", "").action === "block", "plan blocks write");
	check(gate("plan", "edit", "").action === "block", "plan blocks edit");
	check(gate("plan", "bash", "rm -rf x").action === "block", "plan blocks destructive bash");
	check(gate("plan", "bash", "git status").action === "allow", "plan allows read-only bash");
	check(gate("plan", "read", "").action === "allow", "plan allows reads");

	check(gate("auto", "edit", "").action === "allow", "auto applies edits without asking");
	check(gate("auto", "write", "").action === "allow", "auto applies writes without asking");
	check(gate("auto", "bash", "rm -rf x").action === "ask", "auto asks before side-effecting bash");
	check(gate("auto", "bash", "git status").action === "allow", "auto runs read-only bash without asking");

	check(gate("yolo", "write", "").action === "allow", "yolo allows writes");
	check(gate("yolo", "bash", "rm -rf x").action === "allow", "yolo allows anything");

	check(BADGE.plan === "[PLAN]" && BADGE.auto === "[AUTO]" && BADGE.yolo === "", "badges");
	check(NOTICE.auto.includes("bash asks"), "auto notice explains itself");
	console.log("\nAll claude-modes checks passed.");
}
