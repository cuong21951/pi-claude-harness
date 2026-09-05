import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANSI = /\x1b\[[0-9;]*m/g;
const SEPARATOR = " · ";
const MODE_STATUS = "modes";
// ponytail: the permission extension badges yolo with a bare word; the mode row already says it.
const VOICE_STATUS = "voice";
const HIDDEN_STATUSES = new Set([MODE_STATUS, VOICE_STATUS, "pi-permission-system"]);
const SHORTCUTS_HINT = "? for shortcuts";

function plainWidth(text: string): number {
	return text.replace(ANSI, "").length;
}

export type Paint = (role: string, text: string) => string;

export type FooterFacts = {
	statuses: string[];
	model: string;
	thinking: string;
	contextPercent: number | null;
	cost: number;
	branch?: string;
};

function contextRole(percent: number | null): string {
	if (percent === null) return "muted";
	return percent > 90 ? "error" : percent > 70 ? "warning" : "success";
}

function thinkingRole(level: string): string {
	return `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function isPonytail(status: string): boolean {
	return /ponytail/i.test(status.replace(ANSI, ""));
}

// ponytail: Claude Code's footer is one line of " · " separated facts with the ponytail badge first;
// pi has no session/week meters, so cost takes that slot. Extension statuses (API balances, MCP) come
// last so an overflow drops them before the context and cost. Dropping whole parts instead of slicing
// matters: a sliced escape sequence swallows the rest of the line in regular TUI mode.
export function composeFooter(f: FooterFacts, paint: Paint, maxWidth?: number): string {
	const badges = f.statuses.filter(isPonytail);
	const others = f.statuses.filter((status) => !isPonytail(status));
	let parts = [...badges, paint("accent", f.model)];
	if (f.thinking && f.thinking !== "off") parts.push(paint(thinkingRole(f.thinking), `think ${f.thinking}`));
	parts.push(paint(contextRole(f.contextPercent), f.contextPercent === null ? "ctx ?" : `ctx ${Math.round(f.contextPercent)}%`));
	if (f.cost >= 0.005) parts.push(paint("text", `$${f.cost.toFixed(2)}`));
	if (f.branch) parts.push(paint("success", f.branch));
	parts.push(...others);
	if (maxWidth !== undefined) {
		const kept: string[] = [];
		let used = 0;
		for (const part of parts) {
			const width = plainWidth(part) + (kept.length ? SEPARATOR.length : 0);
			if (used + width > maxWidth) break;
			kept.push(part);
			used += width;
		}
		parts = kept;
	}
	return parts.join(paint("dim", SEPARATOR));
}

// ponytail: Claude's second row is the mode on the left and "? for shortcuts" on the right; the voice
// slot ("hold space to speak", "listening…", errors) takes that right-hand place whenever it is set.
export function composeModeRow(mode: string, paint: Paint, width: number, voice?: string): string {
	const hint = voice ?? paint("muted", SHORTCUTS_HINT);
	const gap = width - plainWidth(mode) - plainWidth(hint);
	return gap < 1 ? mode : `${mode}${" ".repeat(gap)}${hint}`;
}

export function badge(status: string, paint: Paint): string {
	return isPonytail(status) ? paint("success", "[PONYTAIL]") : status.trim();
}

export function visibleStatuses(statuses: Map<string, string>, paint: Paint): string[] {
	return [...statuses]
		.filter(([key, text]) => !HIDDEN_STATUSES.has(key) && text.replace(ANSI, "").trim() !== "")
		.map(([, text]) => badge(text, paint));
}

function sessionCost(entries: Iterable<unknown>): number {
	let total = 0;
	for (const entry of entries as Iterable<{ message?: { usage?: { cost?: number | { total?: number } } }; usage?: { cost?: number | { total?: number } } }>) {
		const cost = entry.message?.usage?.cost ?? entry.usage?.cost;
		total += typeof cost === "number" ? cost : (cost?.total ?? 0);
	}
	return total;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((_tui, theme, footerData) => {
			const paint: Paint = (role, text) => theme.fg(role as never, text);
			return {
				render(width: number) {
					const statuses = footerData.getExtensionStatuses();
					const line = composeFooter(
						{
							statuses: visibleStatuses(statuses, paint),
							model: ctx.model?.name ?? ctx.model?.id ?? "no model",
							thinking: ctx.thinkingLevel ?? "off",
							contextPercent: ctx.getContextUsage()?.percent ?? null,
							cost: sessionCost(ctx.sessionManager.getEntries()),
							branch: footerData.getGitBranch() ?? undefined,
						},
						paint,
						width,
					);
					const mode = statuses.get(MODE_STATUS);
					return mode ? [line, composeModeRow(mode, paint, width, statuses.get(VOICE_STATUS))] : [line];
				},
				invalidate() {},
			};
		});
	});
}

if (process.env.CLAUDE_FOOTER_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const plain: Paint = (_role, text) => text;
	const tagged: Paint = (role, text) => `<${role}>${text}</${role}>`;
	const base: FooterFacts = { statuses: ["[PONYTAIL]"], model: "GLM 5.3 Flash", thinking: "high", contextPercent: 22.4, cost: 0.284 };
	check(composeFooter(base, plain) === "[PONYTAIL] · GLM 5.3 Flash · think high · ctx 22% · $0.28", "full line");
	check(composeFooter({ ...base, statuses: [], thinking: "off", cost: 0, contextPercent: null }, plain) === "GLM 5.3 Flash · ctx ?", "minimal line");
	check(!composeFooter({ ...base, cost: 0.004 }, plain).includes("$"), "a cost that rounds to $0.00 is not shown");
	check(composeFooter({ ...base, branch: "master" }, plain).endsWith(" · master"), "branch after cost");
	check(
		composeFooter({ ...base, statuses: ["deepseek $24.57", "[PONYTAIL]", "MCP 1/11"], branch: "master" }, plain) ===
			"[PONYTAIL] · GLM 5.3 Flash · think high · ctx 22% · $0.28 · master · deepseek $24.57 · MCP 1/11",
		"ponytail leads, other statuses trail",
	);
	const coloured = composeFooter({ ...base, contextPercent: 95, branch: "main" }, tagged);
	check(coloured.includes("<accent>GLM 5.3 Flash</accent>"), "model is accent");
	check(coloured.includes("<thinkingHigh>think high</thinkingHigh>"), "think level uses its theme role");
	check(coloured.includes("<error>ctx 95%</error>"), "context above 90% is error");
	check(coloured.includes("<success>main</success>") && coloured.includes("<dim> · </dim>"), "branch success, separators dim");
	check(composeFooter(base, tagged).includes("<success>ctx 22%</success>"), "healthy context is green like Claude's status line");
	check(composeFooter(base, plain) === composeFooter(base, plain, 1000), "no overflow = unchanged");
	const crowded = { ...base, statuses: ["[PONYTAIL]", "deepseek $24.57", "openrouter $20.38", "MCP 1/11"], branch: "master", model: "DeepSeek V4 Flash Vision Exp" };
	const at120 = composeFooter(crowded, plain, 120);
	check(at120.includes("ctx 22%") && at120.includes("$0.28") && at120.includes("master"), "120 columns keep ctx, cost and branch");
	check(!at120.includes("MCP 1/11") && at120.length <= 120, "120 columns drop the trailing statuses first");
	const narrow = composeFooter(base, plain, 30);
	check(narrow === "[PONYTAIL] · GLM 5.3 Flash", "overflow drops whole parts");
	check(!/\x1b\[[0-9;]*$/.test(composeFooter(base, tagged, 30)), "no cut escape sequence at line end");
	check(composeFooter({ ...base, statuses: ["x".repeat(60)] }, plain, 30) === "GLM 5.3 Flash · think high", "a status too wide to fit is dropped, not sliced");
	check(badge("\x1b[32m● ponytail: ⚡ FULL\x1b[0m", tagged) === "<success>[PONYTAIL]</success>", "ponytail status becomes a green badge like Claude's status line");
	check(badge("\x1b[2mMCP: 3 connected\x1b[0m", tagged) === "\x1b[2mMCP: 3 connected\x1b[0m", "other statuses keep their own colours");
	const statuses = new Map([
		["modes", "⏵⏵ accept edits on"],
		["pi-permission-system", "yolo"],
		["cheap", ""],
		["api-balance", "deepseek $1.00"],
	]);
	check(visibleStatuses(statuses, plain).join("|") === "deepseek $1.00", "mode row, yolo word and empty statuses stay out of line one");
	const row = composeModeRow("⏵⏵ accept edits on (shift+tab to cycle)", plain, 80);
	check(row.startsWith("⏵⏵ accept edits on") && row.endsWith("? for shortcuts") && row.length === 80, "mode row: mode left, hint right, exact width");
	check(composeModeRow("⏵⏵ accept edits on (shift+tab to cycle)", plain, 40) === "⏵⏵ accept edits on (shift+tab to cycle)", "too narrow for the hint = mode only");
	const voiceRow = composeModeRow("⏵⏵ accept edits on (shift+tab to cycle)", plain, 80, "\x1b[2mlistening…\x1b[0m");
	check(voiceRow.endsWith("listening…\x1b[0m") && !voiceRow.includes("? for shortcuts") && plainWidth(voiceRow) === 80, "voice slot replaces the shortcuts hint at the same width");
	check(visibleStatuses(new Map([["voice", "listening…"], ["api-balance", "x $1"]]), plain).join("|") === "x $1", "voice status stays out of line one");
	check(sessionCost([{ message: { usage: { cost: { total: 0.1 } } } }, { usage: { cost: 0.2 } }, {}]) === 0.30000000000000004, "cost sums both shapes");
	console.log("\nAll claude-footer checks passed.");
}
