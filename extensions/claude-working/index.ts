import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dynamic } from "../claude-tools/rows.ts";

const VERBS = [
	"Accomplishing", "Actualizing", "Baking", "Brewing", "Calculating", "Cerebrating", "Churning", "Coalescing",
	"Cogitating", "Computing", "Conjuring", "Considering", "Cooking", "Crafting", "Crunching", "Deliberating",
	"Determining", "Finagling", "Forging", "Generating", "Hatching", "Herding", "Honking", "Hustling", "Ideating",
	"Inferring", "Manifesting", "Marinating", "Moseying", "Mulling", "Mustering", "Musing", "Noodling",
	"Percolating", "Pondering", "Processing", "Puttering", "Reticulating", "Ruminating", "Schlepping", "Shimmying",
	"Simmering", "Smooshing", "Spinning", "Stewing", "Swirling", "Synthesizing", "Thinking", "Tinkering",
	"Transmuting", "Vibing", "Wibbling", "Working", "Wrangling",
];

// ponytail: constants below are lifted from Claude Code's spinner (dark theme). Claude itself uses "*"
// instead of ✳ on every terminal but ghostty, so the frame table is verbatim.
const HALF = ["·", "✢", "*", "✶", "✻", "✽"];
const FRAMES = [...HALF, ...HALF.slice().reverse()];
const FRAME_PERIOD_MS = 2000;
const TICK_MS = 100;
const GLIMMER_STEP_MS = 200;
const GLIMMER_WIDTH = 3;
const STALL_AFTER_MS = 10_000;
const STALL_RAMP_MS = 10_000;
const TIMER_ALWAYS_AFTER_MS = 16_000;
const THOUGHT_FOR_MS = 2000;

type Rgb = { r: number; g: number; b: number };
// ponytail: dark-daltonized values, measured on screen: glyph and verb ffaf5f, shimmer ffd787.
const CLAUDE: Rgb = { r: 255, g: 175, b: 95 };
const CLAUDE_SHIMMER: Rgb = { r: 255, g: 215, b: 135 };
const WARNING: Rgb = { r: 255, g: 193, b: 7 };
const STALL_RED: Rgb = { r: 171, g: 43, b: 63 };
const GREY: Rgb = { r: 158, g: 158, b: 158 };
const GREY_BRIGHT: Rgb = { r: 178, g: 178, b: 178 };
const STATUS_GREY: Rgb = { r: 148, g: 148, b: 148 };

export type Mode = "requesting" | "thinking" | "text" | "tool-use";

export interface SpinnerState {
	elapsedMs: number;
	mode: Mode;
	sinceTokenMs: number;
	thinkingMs: number;
	thinkingIntensity: number;
	thoughtForMs: number | null;
	tokens: number;
	effort: string;
}

export function easeCos(t: number, period: number): number {
	return (1 - Math.cos((2 * Math.PI * t) / period)) / 2;
}

export function quantize(x: number): number {
	return Math.round(Math.min(1, Math.max(0, x)) * 8) / 8;
}

export function lerp(a: Rgb, b: Rgb, n: number): Rgb {
	return { r: Math.round(a.r + (b.r - a.r) * n), g: Math.round(a.g + (b.g - a.g) * n), b: Math.round(a.b + (b.b - a.b) * n) };
}

const fg = (c: Rgb) => `\x1b[38;2;${c.r};${c.g};${c.b}m`;
const RESET_FG = "\x1b[39m";
const BOLD = "\x1b[1m";
const UNBOLD = "\x1b[22m";

export function frameIndex(elapsedMs: number): number {
	return Math.round(easeCos(elapsedMs, FRAME_PERIOD_MS) * (FRAMES.length - 1));
}

export function stalledIntensity(sinceTokenMs: number): number {
	return quantize((sinceTokenMs - STALL_AFTER_MS) / STALL_RAMP_MS);
}

export function toneColor(base: Rgb, s: SpinnerState): { color: Rgb; bold: boolean } {
	const stalled = stalledIntensity(s.sinceTokenMs);
	if (stalled > 0) return { color: lerp(base, STALL_RED, stalled), bold: false };
	if (s.thinkingIntensity > 0) return { color: lerp(base, WARNING, quantize(s.thinkingIntensity)), bold: s.thinkingIntensity >= 0.5 };
	return { color: base, bold: false };
}

export function glyph(s: SpinnerState): string {
	const { color, bold } = toneColor(CLAUDE, s);
	const char = FRAMES[frameIndex(s.elapsedMs)];
	return `${bold ? BOLD : ""}${fg(color)}${char}${RESET_FG}${bold ? UNBOLD : ""}`;
}

export function glimmerIndex(elapsedMs: number, width: number, mode: Mode): number {
	const step = Math.floor(elapsedMs / (mode === "requesting" ? 50 : GLIMMER_STEP_MS));
	const cycle = width + 20;
	return mode === "requesting" ? (step % cycle) - 10 : width + 10 - (step % cycle);
}

export function message(text: string, s: SpinnerState): string {
	const tone = toneColor(CLAUDE, s);
	if (tone.color !== CLAUDE) return `${tone.bold ? BOLD : ""}${fg(tone.color)}${text}${RESET_FG}${tone.bold ? UNBOLD : ""}`;
	if (s.mode === "tool-use") {
		const flash = quantize((Math.sin((s.elapsedMs / 1000) * Math.PI) + 1) / 2);
		return `${fg(lerp(CLAUDE, CLAUDE_SHIMMER, flash))}${text}${RESET_FG}`;
	}
	const chars = Array.from(text);
	const centre = glimmerIndex(s.elapsedMs, chars.length, s.mode);
	const lo = centre - (GLIMMER_WIDTH - 1) / 2;
	const hi = centre + (GLIMMER_WIDTH - 1) / 2;
	let out = "";
	for (let i = 0; i < chars.length; i++) out += fg(i >= lo && i <= hi ? CLAUDE_SHIMMER : CLAUDE) + chars[i];
	return out + RESET_FG;
}

export function thinkingPhase(thinkingMs: number): string {
	if (thinkingMs >= 45_000) return "almost done thinking";
	if (thinkingMs >= 30_000) return "thinking some more";
	if (thinkingMs >= 20_000) return "thinking more";
	if (thinkingMs >= 10_000) return "still thinking";
	return "thinking";
}

export function thinkingColor(elapsedMs: number, intensity: number): Rgb {
	const pulse = elapsedMs < 3000 ? 0 : (Math.sin(((elapsedMs - 3000) / 1000) * Math.PI) + 1) / 2;
	const grey = lerp(GREY, GREY_BRIGHT, quantize(pulse));
	return intensity > 0 ? lerp(grey, WARNING, quantize(intensity)) : grey;
}

export function elapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function tokens(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

export function statusText(s: SpinnerState): string {
	const thinking = s.mode === "thinking";
	const parts: string[] = [];
	if (thinking || s.tokens > 0 || s.elapsedMs > TIMER_ALWAYS_AFTER_MS) parts.push(elapsed(s.elapsedMs));
	if (s.tokens > 0) parts.push(`↓ ${tokens(s.tokens)} tokens`);
	if (thinking) {
		const suffix = s.effort && s.effort !== "off" ? ` with ${s.effort} effort` : "";
		parts.push(`${fg(thinkingColor(s.elapsedMs, s.thinkingIntensity))}${thinkingPhase(s.thinkingMs)}${suffix}${RESET_FG}`);
	} else if (s.thoughtForMs !== null) {
		parts.push(`thought for ${Math.max(1, Math.round(s.thoughtForMs / 1000))}s`);
	} else {
		parts.push("esc to interrupt");
	}
	return `${fg(STATUS_GREY)}(${parts.join(" · ")})${RESET_FG}`;
}

const PAST: Record<string, string> = { Thinking: "Thought", Spinning: "Spun", Shimmying: "Shimmied" };

// ponytail: Claude ends a turn with "✻ Churned for 13s · done 12:58 AM" in grey; the verb is the spinner's.
export function pastTense(verb: string): string {
	return PAST[verb] ?? verb.replace(/ing$/, "ed");
}

export function doneLine(verb: string, ms: number, at: Date): string {
	const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
	return `${fg(STATUS_GREY)}✻ ${pastTense(verb)} for ${elapsed(ms)} · done ${time}${RESET_FG}`;
}

export function line(verb: string, s: SpinnerState): string {
	return `${glyph(s)} ${message(`${verb}…`, s)} ${statusText(s)}`;
}

function pickVerb(previous: string): string {
	let verb = previous;
	while (verb === previous) verb = VERBS[Math.floor(Math.random() * VERBS.length)];
	return verb;
}

export default function (pi: ExtensionAPI) {
	let verb = "";
	let started = 0;
	let lastTokenAt = 0;
	let mode: Mode = "requesting";
	let thinkingStart: number | null = null;
	let thoughtForUntil = 0;
	let thoughtForMs: number | null = null;
	let thinkingIntensity = 0;
	let finishedTokens = 0;
	let streamedChars = 0;
	let activeTools = 0;
	let timer: ReturnType<typeof setInterval> | undefined;

	const state = (now: number): SpinnerState => ({
		elapsedMs: now - started,
		mode,
		sinceTokenMs: activeTools > 0 ? 0 : now - lastTokenAt,
		thinkingMs: thinkingStart === null ? 0 : now - thinkingStart,
		thinkingIntensity,
		thoughtForMs: now < thoughtForUntil ? thoughtForMs : null,
		tokens: finishedTokens + Math.round(streamedChars / 4),
		effort: "",
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setWorkingIndicator({ frames: [""], intervalMs: 1000 });
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		verb = pickVerb(verb);
		started = Date.now();
		lastTokenAt = started;
		mode = "requesting";
		thinkingStart = null;
		thoughtForUntil = 0;
		thinkingIntensity = 0;
		finishedTokens = 0;
		streamedChars = 0;
		activeTools = 0;
		clearInterval(timer);
		const paint = () => {
			const now = Date.now();
			const target = mode === "thinking" && activeTools === 0 ? 1 : 0;
			thinkingIntensity += (target - thinkingIntensity) * 0.2;
			if (Math.abs(target - thinkingIntensity) < 0.02) thinkingIntensity = target;
			ctx.ui.setWorkingMessage(line(verb, { ...state(now), effort: ctx.thinkingLevel ?? "" }));
		};
		paint();
		timer = setInterval(paint, TICK_MS);
	});

	pi.on("message_update", (event) => {
		const kind = event.assistantMessageEvent.type;
		const now = Date.now();
		lastTokenAt = now;
		if (kind === "thinking_start" || kind === "thinking_delta") {
			if (thinkingStart === null) thinkingStart = now;
			mode = "thinking";
		} else if (kind === "text_start" || kind === "text_delta" || kind.startsWith("toolcall")) {
			if (thinkingStart !== null) {
				thoughtForMs = now - thinkingStart;
				thoughtForUntil = now + THOUGHT_FOR_MS;
				thinkingStart = null;
			}
			mode = "text";
		}
		if (kind === "text_delta" || kind === "thinking_delta") streamedChars += event.assistantMessageEvent.delta.length;
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		finishedTokens += event.message.usage?.output ?? Math.round(streamedChars / 4);
		streamedChars = 0;
	});

	pi.on("tool_execution_start", () => {
		activeTools++;
		mode = "tool-use";
	});

	pi.on("tool_execution_end", () => {
		activeTools = Math.max(0, activeTools - 1);
		if (activeTools === 0) {
			mode = "requesting";
			lastTokenAt = Date.now();
		}
	});

	pi.registerEntryRenderer("claude-working-done", (entry, _options, theme) => {
		const data = entry.data as { verb: string; ms: number; at: number };
		return dynamic(() => [doneLine(data.verb, data.ms, new Date(data.at))]);
	});

	pi.on("agent_end", (_event, ctx) => {
		clearInterval(timer);
		timer = undefined;
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingMessage();
		pi.appendEntry("claude-working-done", { verb, ms: Date.now() - started, at: Date.now() });
	});
}

if (process.env.CLAUDE_WORKING_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
	const base: SpinnerState = { elapsedMs: 0, mode: "text", sinceTokenMs: 0, thinkingMs: 0, thinkingIntensity: 0, thoughtForMs: null, tokens: 0, effort: "high" };
	check(FRAMES.length === 12 && FRAMES[2] === "*", "Claude frame table: ✳ replaced by * like Claude does off ghostty");
	check(frameIndex(0) === 0 && frameIndex(1000) === 11 && frameIndex(2000) === 0, "cosine ping-pong over 2 s");
	check(stalledIntensity(5000) === 0 && stalledIntensity(15000) === 0.5 && stalledIntensity(30000) === 1, "stall ramps from 10 s to 20 s");
	check(toneColor(CLAUDE, { ...base, sinceTokenMs: 30000 }).color.r === STALL_RED.r, "fully stalled turns red");
	check(toneColor(CLAUDE, { ...base, thinkingIntensity: 1 }).bold === true, "thinking bursts go bold and warm");
	check(visible(message("Vibing…", base)) === "Vibing…", "glimmer keeps the text");
	check(message("Vibing…", base) === message("Vibing…", { ...base, elapsedMs: 200 }), "glimmer starts off the right edge, like Claude");
	check(message("Vibing…", { ...base, elapsedMs: 2200 }) !== message("Vibing…", { ...base, elapsedMs: 2400 }), "glimmer moves every 200 ms once inside the word");
	check(glimmerIndex(0, 7, "text") === 17 && glimmerIndex(200, 7, "text") === 16, "glimmer sweeps right to left");
	check(glimmerIndex(0, 7, "requesting") === -10 && glimmerIndex(50, 7, "requesting") === -9, "requesting sweeps left to right, faster");
	check(message("Vibing…", { ...base, mode: "tool-use", elapsedMs: 500 }).includes(`${CLAUDE_SHIMMER.r};${CLAUDE_SHIMMER.g};${CLAUDE_SHIMMER.b}`), "tool-use flashes the whole word to the shimmer colour at the sine peak");
	check(thinkingPhase(0) === "thinking" && thinkingPhase(10_000) === "still thinking" && thinkingPhase(20_000) === "thinking more" && thinkingPhase(30_000) === "thinking some more" && thinkingPhase(45_000) === "almost done thinking", "thinking phases at 10/20/30/45 s");
	check(visible(statusText({ ...base, mode: "thinking", thinkingMs: 46_000, elapsedMs: 50_000, tokens: 46_500 })) === "(50s · ↓ 46.5k tokens · almost done thinking with high effort)", "status line matches Claude while thinking");
	check(visible(statusText({ ...base, elapsedMs: 225_000, tokens: 5600 })) === "(3m 45s · ↓ 5.6k tokens · esc to interrupt)", "status line matches Claude while streaming");
	check(visible(statusText({ ...base, elapsedMs: 3000 })) === "(esc to interrupt)", "timer hidden before 16 s with no tokens");
	check(visible(statusText({ ...base, elapsedMs: 3000, thoughtForMs: 4200 })) === "(thought for 4s)", "thought-for shown after thinking ends");
	check(elapsed(65000) === "1m 5s" && tokens(14500) === "14.5k", "formatting");
	check(pastTense("Churning") === "Churned" && pastTense("Baking") === "Baked" && pastTense("Thinking") === "Thought" && pastTense("Shimmying") === "Shimmied", "past tense of the spinner verb");
	check(visible(doneLine("Churning", 13_400, new Date(2026, 8, 5, 0, 58))) === "✻ Churned for 13s · done 12:58 AM", "end-of-turn line matches Claude");
	check(pickVerb("Swirling") !== "Swirling", "verb changes between turns");
	console.log(line("Vibing", { ...base, elapsedMs: 225_000, tokens: 5600 }));
}
