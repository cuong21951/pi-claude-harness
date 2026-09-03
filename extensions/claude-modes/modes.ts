export const MODES = ["normal", "plan", "yolo"] as const;
export type Mode = (typeof MODES)[number];

export const BADGE: Record<Mode, string> = {
	normal: "",
	plan: "[PLAN]",
	// ponytail: the permission extension already badges yolo; a second one would just repeat it.
	yolo: "",
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

export function bashAllowedInPlan(command: string): boolean {
	const segments = command.split(/&&|\|\||;|\|/);
	return segments.every((segment) => segment.trim() === "" || READ_ONLY_BASH.test(segment));
}

const BLOCKED_TOOLS = new Set(["write", "edit"]);

export function toolBlockedInPlan(toolName: string): boolean {
	return BLOCKED_TOOLS.has(toolName);
}

if (process.env.CLAUDE_MODES_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(nextMode("normal") === "plan", "normal cycles to plan");
	check(nextMode("plan") === "yolo", "plan cycles to yolo");
	check(nextMode("yolo") === "normal", "yolo wraps to normal");
	check(wantsPlan("make a plan for the migration"), "plan intent");
	check(wantsPlan("lên kế hoạch cho việc này"), "vietnamese plan intent");
	check(wantsPlan("How should we structure this?"), "approach phrasing");
	check(!wantsPlan("turn plan mode off"), "leaving plan is not an offer");
	check(!wantsPlan("fix the failing test"), "ordinary work is not an offer");
	check(!wantsPlan("deploy the planet renderer"), "substring does not match");
	check(bashAllowedInPlan("git status --short"), "read-only bash allowed");
	check(bashAllowedInPlan("ls -la | grep ts"), "pipeline of read-only parts allowed");
	check(!bashAllowedInPlan("rm -rf build"), "destructive bash blocked");
	check(!bashAllowedInPlan("git status && rm x"), "mixed pipeline blocked");
	check(toolBlockedInPlan("write") && toolBlockedInPlan("edit"), "write tools blocked");
	check(!toolBlockedInPlan("read") && !toolBlockedInPlan("grep"), "read tools allowed");
	check(BADGE.plan === "[PLAN]" && BADGE.normal === "" && BADGE.yolo === "", "only plan carries a badge");
	console.log("\nAll claude-modes checks passed.");
}
