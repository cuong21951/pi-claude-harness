import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANSI = /\x1b\[[0-9;]*m/g;
const SEPARATOR = " · ";

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
	if (percent === null) return "dim";
	return percent > 90 ? "error" : percent > 70 ? "warning" : "dim";
}

function thinkingRole(level: string): string {
	return `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

// ponytail: Claude Code's footer is one line of " · " separated facts; pi has no session/week meters, so
// cost takes that slot. Extension statuses come first so the ponytail badge leads like Claude's.
// maxWidth drops whole parts instead of slicing: slicing a coloured string cuts an escape sequence
// mid-way and the terminal swallows the rest of the line (regular TUI mode never sees an overflow).
export function composeFooter(f: FooterFacts, paint: Paint, maxWidth?: number): string {
	let parts = [...f.statuses, paint("accent", f.model)];
	if (f.thinking && f.thinking !== "off") parts.push(paint(thinkingRole(f.thinking), `think ${f.thinking}`));
	parts.push(paint(contextRole(f.contextPercent), f.contextPercent === null ? "ctx ?" : `ctx ${Math.round(f.contextPercent)}%`));
	if (f.cost > 0) parts.push(paint("text", `$${f.cost.toFixed(2)}`));
	if (f.branch) parts.push(paint("success", f.branch));
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

export function badge(status: string, paint: Paint): string {
	const plain = status.replace(ANSI, "").trim();
	return /ponytail/i.test(plain) ? paint("warning", "[PONYTAIL]") : status.trim();
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
					const line = composeFooter(
						{
							statuses: [...footerData.getExtensionStatuses().values()].map((status) => badge(status, paint)),
							model: ctx.model?.name ?? ctx.model?.id ?? "no model",
							thinking: ctx.thinkingLevel ?? "off",
							contextPercent: ctx.getContextUsage()?.percent ?? null,
							cost: sessionCost(ctx.sessionManager.getEntries()),
							branch: footerData.getGitBranch() ?? undefined,
						},
						paint,
						width,
					);
					return [line];
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
	check(composeFooter({ ...base, branch: "master" }, plain).endsWith(" · master"), "branch last");
	const coloured = composeFooter({ ...base, contextPercent: 95, branch: "main" }, tagged);
	check(coloured.includes("<accent>GLM 5.3 Flash</accent>"), "model is accent");
	check(coloured.includes("<thinkingHigh>think high</thinkingHigh>"), "think level uses its theme role");
	check(coloured.includes("<error>ctx 95%</error>"), "context above 90% is error");
	check(coloured.includes("<success>main</success>") && coloured.includes("<dim> · </dim>"), "branch success, separators dim");
	check(composeFooter(base, plain) === composeFooter(base, plain, 1000), "no overflow = unchanged");
	const narrow = composeFooter(base, plain, 30);
	check(narrow === "[PONYTAIL] · GLM 5.3 Flash", "overflow drops whole parts");
	check(narrow.replace(ANSI, "").length <= 30, "fitted line respects width");
	check(!/\x1b\[[0-9;]*$/.test(composeFooter(base, tagged, 30)), "no cut escape sequence at line end");
	check(composeFooter({ ...base, statuses: ["x".repeat(60)] }, plain, 30) === "", "nothing fits = empty line, no overflow");
	check(badge("\x1b[32m● ponytail: ⚡ FULL\x1b[0m", tagged) === "<warning>[PONYTAIL]</warning>", "ponytail status becomes a warning-coloured badge");
	check(badge("\x1b[2mMCP: 3 connected\x1b[0m", tagged) === "\x1b[2mMCP: 3 connected\x1b[0m", "other statuses keep their own colours");
	check(sessionCost([{ message: { usage: { cost: { total: 0.1 } } } }, { usage: { cost: 0.2 } }, {}]) === 0.30000000000000004, "cost sums both shapes");
}
