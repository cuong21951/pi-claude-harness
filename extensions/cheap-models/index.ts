import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ModelLike = { provider: string; id: string; cost?: { input?: number; output?: number } };
type Config = { maxInputPerM: number; maxOutputPerM: number; allow: string[]; deny: string[] };

const DEFAULTS: Config = { maxInputPerM: 1, maxOutputPerM: 3, allow: ["commandcode/*"], deny: [] };

function configPath(): string {
	return path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"), "cheap-models.json");
}

export function loadConfig(file = configPath()): Config {
	try {
		return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, "utf-8")) };
	} catch {
		return DEFAULTS;
	}
}

function preferredModel(): string | undefined {
	try {
		const s = JSON.parse(fs.readFileSync(path.join(path.dirname(configPath()), "settings.json"), "utf-8"));
		return s.defaultProvider && s.defaultModel ? `${s.defaultProvider}/${s.defaultModel}` : undefined;
	} catch {
		return undefined;
	}
}

function glob(pattern: string): RegExp {
	return new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
}

export function key(model: ModelLike): string {
	return `${model.provider}/${model.id}`;
}

// ponytail: a model is cheap when it is explicitly allowed, or its catalog price is under the caps.
// Unknown price counts as expensive; the deny list always wins. pi swallows errors thrown
// from before_provider_request, so the only real guard is swapping the model before a turn.
export function isCheap(model: ModelLike, cfg: Config): boolean {
	const k = key(model);
	if (cfg.deny.some((p) => glob(p).test(k))) return false;
	if (cfg.allow.some((p) => glob(p).test(k))) return true;
	const input = model.cost?.input;
	const output = model.cost?.output;
	if (typeof input !== "number" || typeof output !== "number") return false;
	return input <= cfg.maxInputPerM && output <= cfg.maxOutputPerM;
}

export function pickCheap(models: ModelLike[], cfg: Config, preferred?: string): ModelLike | undefined {
	const cheap = models.filter((m) => isCheap(m, cfg));
	return cheap.find((m) => key(m) === preferred) ?? cheap[0];
}

export default function (pi: ExtensionAPI) {
	const cfg = loadConfig();
	let lastGood: ModelLike | undefined;

	async function enforce(ctx: any, source: string): Promise<void> {
		const current = ctx.model as ModelLike | undefined;
		if (current && isCheap(current, cfg)) {
			lastGood = current;
			return;
		}
		const available = ctx.modelRegistry.getAvailable() as ModelLike[];
		const replacement = (lastGood && isCheap(lastGood, cfg) ? lastGood : undefined) ?? pickCheap(available, cfg, preferredModel());
		const label = current ? key(current) : "no model";
		if (!replacement) {
			ctx.ui?.notify?.(`cheap-models: ${label} is not allowed and no cheap model is available`, "error");
			return;
		}
		await pi.setModel(replacement as never);
		lastGood = replacement;
		const text = `cheap-models: blocked ${label} (${source}); using ${key(replacement)}`;
		if (ctx.hasUI) ctx.ui.notify(text, "warning");
		else console.error(text);
	}

	pi.on("session_start", (_e, ctx) => enforce(ctx, "session start"));
	pi.on("model_select", (_e, ctx) => enforce(ctx, "model picker"));
	pi.on("before_agent_start", (_e, ctx) => enforce(ctx, "turn start"));
}

if (process.env.CHEAP_MODELS_SELFTEST) {
	const cfg = DEFAULTS;
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const fable = { provider: "openrouter", id: "~anthropic/claude-fable-latest", cost: { input: 15, output: 75 } };
	const glm = { provider: "openrouter", id: "z-ai/glm-5.3-flash", cost: { input: 0.075, output: 0.25 } };
	const proxy = { provider: "commandcode", id: "zai-org/GLM-5.3", cost: { input: 1.4, output: 4.4 } };
	const unknown = { provider: "openrouter", id: "some/new-model" };
	check(!isCheap(fable, cfg), "Fable is blocked by price");
	check(isCheap(glm, cfg), "GLM Flash passes the price caps");
	check(isCheap(proxy, cfg), "commandcode/* is allowed regardless of price");
	check(!isCheap(unknown, cfg), "unknown price is treated as expensive");
	check(!isCheap(glm, { ...cfg, deny: ["openrouter/z-ai/*"] }), "deny list wins over price");
	check(pickCheap([fable, glm], cfg)?.id === "z-ai/glm-5.3-flash", "picks the first cheap model");
	check(pickCheap([glm, proxy], cfg, "commandcode/zai-org/GLM-5.3")?.provider === "commandcode", "prefers the requested cheap model");
}
