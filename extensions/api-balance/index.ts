import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const REFRESH_MS = 10 * 60 * 1000;

export type Balance = { label: string; amount: number; currency: string };
type Fetcher = (key: string) => Promise<Balance>;

async function getJson(url: string, key: string): Promise<any> {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

// ponytail: one fetcher per provider that has a balance endpoint; add a line here for a new one.
const PROVIDERS: Record<string, Fetcher> = {
	deepseek: async (key) => {
		const info = (await getJson("https://api.deepseek.com/user/balance", key)).balance_infos?.[0];
		return { label: "deepseek", amount: Number(info?.total_balance ?? NaN), currency: info?.currency ?? "USD" };
	},
	openrouter: async (key) => {
		const data = (await getJson("https://openrouter.ai/api/v1/credits", key)).data;
		return { label: "openrouter", amount: Number(data.total_credits) - Number(data.total_usage), currency: "USD" };
	},
};

export function balanceText(b: Balance): { text: string; role: "success" | "warning" | "error" } {
	if (Number.isNaN(b.amount)) return { text: `${b.label} ?`, role: "warning" };
	const symbol = b.currency === "CNY" ? "¥" : b.currency === "USD" ? "$" : `${b.currency} `;
	return { text: `${b.label} ${symbol}${b.amount.toFixed(2)}`, role: b.amount < 1 ? "error" : b.amount < 5 ? "warning" : "success" };
}

async function refresh(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	for (const [provider, fetchBalance] of Object.entries(PROVIDERS)) {
		const statusKey = `balance-${provider}`;
		const key = await ctx.modelRegistry.getApiKeyForProvider(provider);
		if (!key) {
			ctx.ui.setStatus(statusKey, undefined);
			continue;
		}
		try {
			const { text, role } = balanceText(await fetchBalance(key));
			ctx.ui.setStatus(statusKey, ctx.ui.theme.fg(role, text));
		} catch {
			ctx.ui.setStatus(statusKey, ctx.ui.theme.fg("warning", `${provider} ?`));
		}
	}
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	pi.on("session_start", (_event, ctx) => {
		clearInterval(timer);
		void refresh(ctx);
		timer = setInterval(() => void refresh(ctx), REFRESH_MS);
	});
	pi.on("agent_end", (_event, ctx) => void refresh(ctx));
	pi.on("session_shutdown", () => clearInterval(timer));
}

if (process.env.API_BALANCE_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(balanceText({ label: "deepseek", amount: 12.345, currency: "CNY" }).text === "deepseek ¥12.35", "CNY formatting");
	check(balanceText({ label: "openrouter", amount: 5.703, currency: "USD" }).text === "openrouter $5.70", "USD formatting");
	check(balanceText({ label: "x", amount: 0.5, currency: "USD" }).role === "error", "under 1 is error");
	check(balanceText({ label: "x", amount: 3, currency: "USD" }).role === "warning", "under 5 is warning");
	check(balanceText({ label: "x", amount: 50, currency: "USD" }).role === "success", "healthy is success");
	check(balanceText({ label: "deepseek", amount: NaN, currency: "USD" }).text === "deepseek ?", "unknown amount");
}
