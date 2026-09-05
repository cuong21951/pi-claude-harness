// Voice dictation for pi, cloned from Claude Code 2.1.261: hold Space to talk, release to insert.
// /voice [hold|tap|off] · alt+r taps · Esc cancels. Local faster-whisper sidecar, nothing leaves the machine.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const SPACE = " ";
const ESC = "\x1b";
export const CURSOR_MARKER = "\x1b_pi:c\x07";
const ANSI = /\x1b\[[0-9;]*m/g;
const PROMPT_WIDTH = 2;

// Claude Code 2.1.261 voice constants, read from its bundle.
const LEVEL_GLYPHS = " ▁▂▃▄▅▆▇█";
const LEVEL_GAIN = 1.8;
const LEVEL_KEEP = 0.7;
const QUIET_LEVEL = 0.15;
const SIGNAL_LEVEL = 0.01;
const LEVEL_RING = 16;
const HUE_DEG_PER_SEC = 90;
const PULSE_FROM = 153;
const PULSE_TO = 185;
const PULSE_PERIOD_MS = 2000;
const TICK_MS = 50;
const INTERIM_MS = 500;
const INTERIM_MIN_BYTES = 16000;
const SILENCE_MS = 15000;
const ERROR_MS = 5000;
const HINT_SESSIONS = 3;
const AUTO_SUBMIT_WORDS = 3;

export const NO_AUDIO = "No audio detected from microphone. Check that the correct input device is selected and that pi has microphone access.";
export const NO_SPEECH = "No speech detected.";

export type VoiceMode = "hold" | "tap";

export type VoiceConfig = {
	enabled: boolean;
	mode: VoiceMode;
	autoSubmit: boolean;
	hintSessions: number;
	model: string;
	device: string;
	language: string | null;
	mic: string | null;
	beamSize: number;
	warmupRepeats: number;
	warmupWindowMs: number;
	releaseGapMs: number;
	maxDurationSec: number;
};

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
	enabled: true,
	mode: "hold",
	autoSubmit: false,
	hintSessions: 0,
	model: "large-v3-turbo",
	device: "auto",
	language: null,
	mic: null,
	beamSize: 5,
	warmupRepeats: 4,
	warmupWindowMs: 600,
	releaseGapMs: 350,
	maxDurationSec: 120,
};

export const voiceConfigPath = () => join(homedir(), ".pi", "agent", "voice.json");

export function loadVoiceConfig(path: string = voiceConfigPath()): VoiceConfig {
	try {
		if (existsSync(path)) return { ...DEFAULT_VOICE_CONFIG, ...JSON.parse(readFileSync(path, "utf8")) };
	} catch {
		// Corrupt config falls back to defaults below.
	}
	try {
		writeFileSync(path, JSON.stringify(DEFAULT_VOICE_CONFIG, null, 2));
	} catch {
		// Read-only home; defaults still work for the session.
	}
	return { ...DEFAULT_VOICE_CONFIG };
}

export function saveVoiceConfig(config: VoiceConfig, path: string = voiceConfigPath()): void {
	writeFileSync(path, JSON.stringify(config, null, 2));
}

export function parseAudioDevices(ffmpegOutput: string): string[] {
	const names: string[] = [];
	for (const match of ffmpegOutput.matchAll(/"([^"]+)"\s*\(audio\)/g)) names.push(match[1]!);
	return names;
}

export function pickMic(devices: string[], override: string | null): string | null {
	if (override) return override;
	return devices.find((d) => /microphone|\bmic\b|default/i.test(d)) ?? devices[0] ?? null;
}

export function stripWarmupSpaces(editor: string, maxCount: number): string {
	let end = editor.length;
	let removed = 0;
	while (removed < maxCount && end > 0 && editor[end - 1] === " ") {
		end--;
		removed++;
	}
	return editor.slice(0, end);
}

export function warmupHit(times: number[], now: number, repeats: number, windowMs: number): boolean {
	let count = 0;
	for (let i = times.length - 1; i >= 0; i--) {
		if (now - times[i]! > windowMs) break;
		if (++count >= repeats) return true;
	}
	return false;
}

export function cleanTranscript(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

// Claude's insert rule: one space between the anchor and the transcript unless a space is already there.
export function joinAround(before: string, text: string, after: string): string {
	if (text === "") return before + after;
	const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const trail = after.length > 0 && !/^\s/.test(after) ? " " : "";
	return before + lead + text + trail + after;
}

export function wordCount(text: string): number {
	const trimmed = text.trim();
	return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function autoSubmits(text: string): boolean {
	return wordCount(text) >= AUTO_SUBMIT_WORDS;
}

// sqrt of the RMS of 16-bit samples against a 2000 ceiling, exactly Claude's level function.
export function chunkLevel(pcm: Buffer): number {
	const samples = pcm.length >> 1;
	if (samples === 0) return 0;
	let sum = 0;
	for (let i = 0; i + 1 < pcm.length; i += 2) {
		const v = pcm.readInt16LE(i);
		sum += v * v;
	}
	return Math.sqrt(Math.min(Math.sqrt(sum / samples) / 2000, 1));
}

// 16 kHz mono 16-bit WAV around the PCM ffmpeg streams; the interim and final passes read this, not ffmpeg files.
export function wavFromPcm(chunks: Buffer[], sampleRate: number = 16000): Buffer {
	const pcm = Buffer.concat(chunks);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

export class LevelSmoother {
	private value = 0;
	next(target: number, keep: number = LEVEL_KEEP): number {
		this.value = this.value * keep + target * (1 - keep);
		return this.value;
	}
	reset(): void {
		this.value = 0;
	}
}

export function levelGlyph(smoothed: number): string {
	const last = LEVEL_GLYPHS.length - 1;
	return LEVEL_GLYPHS[Math.max(1, Math.min(Math.round(smoothed * last), last))]!;
}

export function hueRgb(hue: number): [number, number, number] {
	const h = ((hue % 360) + 360) % 360;
	const chroma = (1 - Math.abs(2 * 0.6 - 1)) * 0.7;
	const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = 0.6 - chroma / 2;
	const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgb(r: number, g: number, b: number, text: string): string {
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

export function cursorGlyph(level: number, smoothed: number, elapsedMs: number): string {
	const [r, g, b] = level < QUIET_LEVEL ? [128, 128, 128] : hueRgb((elapsedMs / 1000) * HUE_DEG_PER_SEC);
	return rgb(r, g, b, levelGlyph(smoothed));
}

export function pulseGrey(elapsedMs: number): number {
	const t = (Math.sin(((elapsedMs / 1000) * Math.PI * 2) / (PULSE_PERIOD_MS / 1000)) + 1) / 2;
	return Math.round(PULSE_FROM + (PULSE_TO - PULSE_FROM) * t);
}

export function processingText(elapsedMs: number): string {
	const v = pulseGrey(elapsedMs);
	return rgb(v, v, v, "Voice: processing…");
}

function plainWidth(text: string): number {
	return text.replace(ANSI, "").replaceAll(CURSOR_MARKER, "").length;
}

// The interim transcript is drawn dimmed at the cursor with the level glyph in the cursor's place,
// wrapping onto continuation rows aligned under the prompt. Rows without a cursor are left alone.
export function voiceRows(rows: string[], interim: string, glyph: string, width: number, dim: (text: string) => string, indent: number = PROMPT_WIDTH): string[] {
	const at = rows.findIndex((row) => row.includes(CURSOR_MARKER));
	if (at === -1) return rows;
	const row = rows[at]!;
	const cut = row.indexOf(CURSOR_MARKER);
	const before = row.slice(0, cut);
	// pi pads editor rows to the full width; the glyph takes the column the zero-width marker had.
	const after = row.slice(cut + CURSOR_MARKER.length).replace(/ +$/, "");
	const firstRoom = Math.max(0, width - plainWidth(before) - 1);
	const restRoom = Math.max(1, width - indent - 1);
	const paint = (text: string) => (text === "" ? "" : dim(text));
	const out = [before + paint(interim.slice(0, firstRoom))];
	let rest = interim.slice(firstRoom);
	while (rest !== "") {
		out.push(" ".repeat(indent) + paint(rest.slice(0, restRoom)));
		rest = rest.slice(restRoom);
	}
	const last = out.length - 1;
	const fits = plainWidth(out[last]! + after) < width;
	out[last] += (fits ? glyph : "") + after;
	out[last] += " ".repeat(Math.max(0, width - plainWidth(out[last]!)));
	return [...rows.slice(0, at), ...out, ...rows.slice(at + 1)];
}

export function wrapText(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line !== "" && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else line = line === "" ? word : `${line} ${word}`;
	}
	return line === "" ? lines : [...lines, line];
}

export function enableMessage(mode: VoiceMode, language: string | null): string {
	const how = mode === "tap" ? "Tap Space (with input empty) to start, tap again to send." : "Hold space to record.";
	return `Voice mode enabled (${mode}). ${how} Dictation language: ${language ?? "auto"} (voice.json to change).`;
}

export function voiceCommandOutput(arg: string, config: VoiceConfig): { text: string; enabled?: boolean; mode?: VoiceMode } {
	if (arg === "off") return { text: "Voice mode disabled.", enabled: false };
	if (arg === "hold" || arg === "tap") return { text: enableMessage(arg, config.language), enabled: true, mode: arg };
	if (arg !== "") return { text: `Unknown mode: "${arg}". Use hold, tap, or off.` };
	if (config.enabled) return { text: "Voice mode disabled.", enabled: false };
	return { text: enableMessage(config.mode, config.language), enabled: true, mode: config.mode };
}

const voiceLogPath = () => join(tmpdir(), "pi-voice.log");

export function logVoice(message: string): void {
	try {
		appendFileSync(voiceLogPath(), `${new Date().toISOString()} ${message}\n`);
	} catch {
		// Logging must never break recording.
	}
}

export function sidecarDir(): string {
	try {
		return dirname(fileURLToPath(import.meta.url));
	} catch {
		return join(homedir(), ".pi", "agent", "extensions", "voice");
	}
}

function runCapture(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
			resolve({ stdout: String(stdout ?? ""), stderr: String(error ? (error as { stderr?: string }).stderr ?? stderr : stderr) });
		});
	});
}

export type VoiceUi = {
	paint: (role: "muted" | "error", text: string) => string;
	setSlot: (text: string | undefined) => void;
	getEditorText: () => string;
	setEditorText: (text: string) => void;
	submit: (text: string) => void;
	requestRender: () => void;
};

type Pending = { resolve: (text: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

class Transcriber {
	private proc: ChildProcess | null = null;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private ready: Promise<{ model: string; device: string }> | null = null;
	private config: VoiceConfig;
	private dir: string;

	constructor(config: VoiceConfig, dir: string) {
		this.config = config;
		this.dir = dir;
	}

	ensure(): Promise<{ model: string; device: string }> {
		this.ready ??= this.start();
		return this.ready;
	}

	private start(): Promise<{ model: string; device: string }> {
		return new Promise((resolve, reject) => {
			const python = process.platform === "win32" ? "py -3.12" : "python3";
			const [cmd, ...prefix] = python.split(" ");
			const proc = spawn(cmd, [...prefix, "-u", join(this.dir, "sidecar.py"), "--model", this.config.model, "--device", this.config.device, "--beam", String(this.config.beamSize), "--parent", String(process.pid)], {
				stdio: ["pipe", "pipe", "ignore"],
			});
			this.proc = proc;
			const failTimer = setTimeout(() => {
				this.reset(new Error("voice model timed out while loading (first run downloads ~1.6GB)"));
				reject(new Error("voice model timed out while loading"));
			}, 600_000);
			proc.on("error", (err) => {
				clearTimeout(failTimer);
				this.reset(err);
				reject(err);
			});
			proc.on("exit", () => {
				clearTimeout(failTimer);
				this.reset(new Error("voice model exited unexpectedly"));
				reject(new Error("voice model exited unexpectedly"));
			});
			const rl = createInterface({ input: proc.stdout });
			rl.on("line", (line) => {
				let msg: { ready?: boolean; model?: string; device?: string; id?: number; text?: string; error?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.ready) {
					clearTimeout(failTimer);
					resolve({ model: msg.model ?? this.config.model, device: msg.device ?? "?" });
					return;
				}
				if (msg.id === undefined) return;
				const job = this.pending.get(msg.id);
				if (!job) return;
				this.pending.delete(msg.id);
				clearTimeout(job.timer);
				if (msg.error) job.reject(new Error(msg.error));
				else job.resolve(msg.text ?? "");
			});
		});
	}

	private reset(err: Error): void {
		for (const job of this.pending.values()) {
			clearTimeout(job.timer);
			job.reject(err);
		}
		this.pending.clear();
		this.proc = null;
		this.ready = null;
	}

	transcribe(wav: string, initialPrompt: string, beam: number = this.config.beamSize): Promise<string> {
		return this.ensure().then(
			() =>
				new Promise<string>((resolve, reject) => {
					const id = this.nextId++;
					const timer = setTimeout(() => {
						this.pending.delete(id);
						reject(new Error("transcription timed out"));
					}, 180_000);
					this.pending.set(id, { resolve, reject, timer });
					this.proc?.stdin?.write(JSON.stringify({ id, wav, beam, language: this.config.language, initial_prompt: initialPrompt }) + "\n");
				}),
		);
	}

	shutdown(): void {
		try {
			this.proc?.stdin?.write(JSON.stringify({ cmd: "shutdown" }) + "\n");
		} catch {
			// Already gone; kill below covers it.
		}
		const proc = this.proc;
		setTimeout(() => proc?.kill(), 2000).unref?.();
		this.proc = null;
		this.ready = null;
	}
}

type State = "idle" | "recording" | "processing";

export class VoiceRecorder {
	private ui: VoiceUi;
	private config: VoiceConfig;
	private cwd: string;
	private state: State = "idle";
	private mode: VoiceMode = "hold";
	private warmup: number[] = [];
	private warmupSpaces = 0;
	private warmupTimer?: ReturnType<typeof setTimeout>;
	private proc: ChildProcess | null = null;
	private segDir = "";
	private anchor = "";
	private promptHint = "";
	private exitCode: number | null = null;
	private stderr = "";
	private pcm: Buffer[] = [];
	private pcmBytes = 0;
	private interimBytes = 0;
	private interim = "";
	private interimTimer?: ReturnType<typeof setTimeout>;
	private interimBusy = false;
	private levels: number[] = [];
	private smoother = new LevelSmoother();
	private hadSignal = false;
	private lastLoudAt = 0;
	private startedAt = 0;
	private processingAt = 0;
	private gapTimer?: ReturnType<typeof setTimeout>;
	private ticker?: ReturnType<typeof setTimeout>;
	private maxTimer?: ReturnType<typeof setTimeout>;
	private errorTimer?: ReturnType<typeof setTimeout>;
	private hintTimer?: ReturnType<typeof setTimeout>;
	private finishing = false;
	private ffmpegOk = false;
	private devices: string[] = [];
	private transcriber: Transcriber;

	constructor(ui: VoiceUi, config: VoiceConfig, cwd: string, dir: string = sidecarDir()) {
		this.ui = ui;
		this.config = config;
		this.cwd = cwd;
		this.transcriber = new Transcriber(config, dir);
	}

	async init(): Promise<void> {
		const version = await runCapture("ffmpeg", ["-version"], 5000);
		this.ffmpegOk = version.stdout.startsWith("ffmpeg version");
		if (!this.ffmpegOk) {
			this.showError("Voice mode requires ffmpeg on PATH.");
			return;
		}
		const list = await runCapture("ffmpeg", ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], 10000);
		this.devices = parseAudioDevices(list.stderr);
		this.refreshHint();
		// ponytail: the model loads at session start (~2 GB VRAM per pi session) so the first hold streams at once.
		if (this.config.enabled && this.devices.length > 0) void this.transcriber.ensure().catch(() => undefined);
	}

	// Footer slot while idle: Claude shows "hold space to speak" on an empty prompt for the first sessions.
	refreshHint(): void {
		if (this.state !== "idle" || this.errorTimer || this.warmup.length > 1) return;
		const show = this.config.enabled && this.ffmpegOk && this.config.hintSessions <= HINT_SESSIONS && this.ui.getEditorText() === "";
		this.ui.setSlot(show ? this.ui.paint("muted", "hold space to speak") : undefined);
		this.ui.requestRender();
	}

	private scheduleHint(): void {
		clearTimeout(this.hintTimer);
		this.hintTimer = setTimeout(() => this.refreshHint(), 0);
	}

	// A loaded terminal hands several key-repeat spaces over in one chunk; each still counts as a repeat.
	onInput(data: string): { consume: true } | undefined {
		if (process.env.VOICE_TRACE) logVoice(`input ${JSON.stringify(data)} state=${this.state} warmup=${this.warmup.length}`);
		this.scheduleHint();
		if (this.state === "recording") return this.recordingInput(data);
		if (this.state !== "idle" || !this.config.enabled || !this.ffmpegOk) return undefined;
		if (!/^ +$/.test(data)) {
			this.warmup = [];
			return undefined;
		}
		if (this.config.mode === "tap") {
			if (this.ui.getEditorText() !== "") return undefined;
			void this.start("tap");
			return { consume: true };
		}
		const now = Date.now();
		this.warmup = [...this.warmup.filter((t) => now - t <= this.config.warmupWindowMs), ...Array<number>(data.length).fill(now)];
		if (this.warmup.length > 1) {
			this.ui.setSlot(this.ui.paint("muted", "keep holding…"));
			clearTimeout(this.warmupTimer);
			this.warmupTimer = setTimeout(() => {
				this.warmup = [];
				this.refreshHint();
			}, this.config.warmupWindowMs);
		}
		if (warmupHit(this.warmup, now, this.config.warmupRepeats, this.config.warmupWindowMs)) {
			this.warmupSpaces = this.warmup.length;
			this.warmup = [];
			clearTimeout(this.warmupTimer);
			void this.start("hold");
		}
		return undefined;
	}

	private recordingInput(data: string): { consume: true } | undefined {
		if (/^ +$/.test(data)) {
			if (this.mode === "hold") this.armGapTimer();
			else void this.finish(false);
			return { consume: true };
		}
		if (data === ESC) {
			void this.finish(true);
			return { consume: true };
		}
		return undefined;
	}

	async toggle(): Promise<void> {
		if (this.state === "recording") {
			await this.finish(false);
			return;
		}
		if (this.state !== "idle") return;
		if (!this.config.enabled) {
			this.showError("Voice mode is off. Run /voice to enable it.");
			return;
		}
		this.warmupSpaces = 0;
		await this.start("tap");
	}

	private async start(mode: VoiceMode): Promise<void> {
		if (this.state !== "idle" || this.finishing) return;
		const mic = pickMic(this.devices, this.config.mic);
		if (!mic) {
			this.showError("Voice mode requires a microphone, but no audio device is available.");
			return;
		}
		this.mode = mode;
		this.segDir = join(tmpdir(), `pi-voice-${Date.now()}`);
		mkdirSync(this.segDir, { recursive: true });
		this.exitCode = null;
		this.stderr = "";
		this.pcm = [];
		this.pcmBytes = 0;
		this.interimBytes = 0;
		this.interim = "";
		this.levels = [];
		this.smoother.reset();
		this.hadSignal = false;
		void this.gitBranch().then((branch) => {
			this.promptHint = branch ? `Project ${basename(this.cwd)}. Git branch ${branch}.` : `Project ${basename(this.cwd)}.`;
		});
		void this.transcriber.ensure().catch(() => undefined);
		const proc = spawn(
			"ffmpeg",
			["-hide_banner", "-loglevel", "error", "-t", String(this.config.maxDurationSec), "-f", "dshow", "-i", `audio=${mic}`, "-map", "0:a", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
			{ cwd: this.segDir, stdio: ["pipe", "pipe", "pipe"] },
		);
		this.proc = proc;
		this.state = "recording";
		this.startedAt = Date.now();
		this.lastLoudAt = this.startedAt;
		this.clearError();
		this.ui.setEditorText(stripWarmupSpaces(this.ui.getEditorText(), this.warmupSpaces));
		this.warmupSpaces = 0;
		this.anchor = this.ui.getEditorText();
		logVoice(`start mode=${mode} mic=${mic}`);
		this.ui.setSlot(this.recordingSlot());
		proc.stdout?.on("data", (chunk: Buffer) => this.onPcm(chunk));
		proc.stderr?.on("data", (chunk: Buffer) => {
			this.stderr += chunk.toString();
		});
		this.ticker = setInterval(() => this.tick(), TICK_MS);
		this.interimTimer = setInterval(() => void this.pollInterim(), INTERIM_MS);
		this.maxTimer = setTimeout(() => void this.finish(false), this.config.maxDurationSec * 1000);
		if (mode === "hold") this.armGapTimer();
		proc.on("error", () => this.abortStart("Voice recording could not start ffmpeg."));
		proc.on("exit", (code) => {
			this.exitCode = code ?? 0;
			logVoice(`ffmpeg exit code=${this.exitCode} after ${Date.now() - this.startedAt}ms stderr=${this.stderr.trim().slice(-300)}`);
			if (this.state === "recording" && Date.now() - this.startedAt < 1500 && this.exitCode !== 0) this.abortStart(NO_AUDIO);
		});
	}

	private recordingSlot(): string {
		if (this.mode === "tap") return this.ui.paint("error", "● REC") + this.ui.paint("muted", " · tap to send");
		return this.ui.paint("muted", "listening…");
	}

	private onPcm(chunk: Buffer): void {
		this.pcm.push(chunk);
		this.pcmBytes += chunk.length;
		const level = chunkLevel(chunk);
		if (level > SIGNAL_LEVEL) this.hadSignal = true;
		if (this.levels.length >= LEVEL_RING) this.levels.shift();
		this.levels.push(level);
	}

	private tick(): void {
		if (this.state === "recording") {
			this.smoother.next(Math.min((this.levels.at(-1) ?? 0) * LEVEL_GAIN, 1));
			// ponytail: silence = whisper heard no words for 15 s; a mic noise floor would fool a level threshold.
			if (this.mode === "tap" && Date.now() - this.lastLoudAt > SILENCE_MS) {
				logVoice(`silence stop after ${Date.now() - this.startedAt}ms`);
				void this.finish(false);
			}
		} else if (this.state === "processing") {
			this.ui.setSlot(processingText(Date.now() - this.processingAt));
		}
		this.ui.requestRender();
	}

	// Editor rows decorated the way Claude draws them: dimmed interim at the cursor, level glyph as cursor.
	decorate(rows: string[], width: number): string[] {
		if (this.state === "idle") return rows;
		const dim = (text: string) => this.ui.paint("muted", text);
		const glyph = this.state === "recording" ? cursorGlyph(this.levels.at(-1) ?? 0, this.smoother.next(Math.min((this.levels.at(-1) ?? 0) * LEVEL_GAIN, 1), 1), Date.now() - this.startedAt) : CURSOR_MARKER;
		const lead = this.anchor.length > 0 && !/\s$/.test(this.anchor) && this.interim !== "" ? " " : "";
		return voiceRows(rows, lead + this.interim, glyph, width, dim);
	}

	private abortStart(message: string): void {
		if (this.state !== "recording") return;
		this.clearTimers();
		this.state = "idle";
		this.showError(message);
		this.removeSessionFiles();
	}

	// ponytail: every half second the whole recording so far is decoded again with beam 1, so words show
	// while you speak like Claude's streaming service. Quadratic in length; fine under the 2-minute cap.
	private async pollInterim(): Promise<void> {
		if (this.state !== "recording" || this.interimBusy || this.pcmBytes - this.interimBytes < INTERIM_MIN_BYTES) return;
		this.interimBusy = true;
		try {
			this.interimBytes = this.pcmBytes;
			const wav = join(this.segDir, "interim.wav");
			writeFileSync(wav, wavFromPcm(this.pcm));
			const text = cleanTranscript(await this.transcriber.transcribe(wav, this.promptHint, 1));
			if (this.state !== "recording") return;
			if (text !== this.interim) {
				if (text !== "") this.lastLoudAt = Date.now();
				this.interim = text;
				this.ui.requestRender();
			}
		} catch {
			// Interim is best effort; the final pass on release is authoritative.
		} finally {
			this.interimBusy = false;
		}
	}

	private armGapTimer(): void {
		clearTimeout(this.gapTimer);
		// ponytail: key-release needs the Kitty protocol, which Windows terminals may not send,
		// so release = silence on the repeat stream, the same trick Claude Code uses.
		this.gapTimer = setTimeout(() => void this.finish(false), this.config.releaseGapMs);
	}

	private clearTimers(): void {
		clearTimeout(this.gapTimer);
		clearTimeout(this.maxTimer);
		clearTimeout(this.interimTimer);
		clearInterval(this.ticker);
	}

	private showError(message: string): void {
		clearTimeout(this.errorTimer);
		this.ui.setSlot(this.ui.paint("error", message));
		this.errorTimer = setTimeout(() => {
			this.errorTimer = undefined;
			this.refreshHint();
		}, ERROR_MS);
		this.ui.requestRender();
	}

	private clearError(): void {
		clearTimeout(this.errorTimer);
		this.errorTimer = undefined;
	}

	private async finish(cancelled: boolean): Promise<void> {
		if (this.state !== "recording" || this.finishing) return;
		this.finishing = true;
		this.clearTimers();
		const proc = this.proc;
		this.proc = null;
		try {
			if (cancelled) {
				proc?.kill();
			} else {
				proc?.stdin?.write("q");
				await new Promise<void>((resolve) => {
					const done = () => resolve();
					proc?.on("exit", done);
					setTimeout(() => {
						proc?.kill();
						resolve();
					}, 1000);
				});
			}
		} finally {
			this.finishing = false;
		}
		if (cancelled) {
			this.state = "idle";
			this.interim = "";
			this.removeSessionFiles();
			this.refreshHint();
			this.ui.requestRender();
			return;
		}
		this.state = "processing";
		this.processingAt = Date.now();
		this.ui.setSlot(processingText(0));
		this.ticker = setInterval(() => this.tick(), TICK_MS);
		const size = this.pcmBytes;
		logVoice(`stop size=${size} exit=${this.exitCode} signal=${this.hadSignal} interim=${JSON.stringify(this.interim.slice(0, 60))}`);
		try {
			if (size < 4096 || !this.hadSignal) {
				this.showError(NO_AUDIO);
				return;
			}
			const wav = join(this.segDir, "final.wav");
			writeFileSync(wav, wavFromPcm(this.pcm));
			const text = cleanTranscript(await this.transcriber.transcribe(wav, this.promptHint || `Project ${basename(this.cwd)}.`));
			if (!text) {
				this.showError(NO_SPEECH);
				return;
			}
			const diverged = this.ui.getEditorText() !== this.anchor;
			const full = joinAround(diverged ? this.ui.getEditorText() : this.anchor, text, "");
			if (this.mode === "tap" || this.config.autoSubmit) {
				if (autoSubmits(text)) {
					this.ui.setEditorText("");
					this.ui.submit(full);
					return;
				}
			}
			this.ui.setEditorText(full);
		} catch (err) {
			logVoice(`transcribe failed size=${size}: ${(err as Error).message}`);
			this.showError(`Voice transcription failed: ${(err as Error).message}`);
		} finally {
			clearInterval(this.ticker);
			this.state = "idle";
			this.interim = "";
			this.removeSessionFiles();
			if (!this.errorTimer) this.refreshHint();
			this.ui.requestRender();
		}
	}

	private removeSessionFiles(): void {
		try {
			if (this.segDir) rmSync(this.segDir, { recursive: true, force: true });
		} catch {
			// Best effort; tmpdir is OS-cleaned anyway.
		}
		this.segDir = "";
		this.pcm = [];
	}

	private async gitBranch(): Promise<string> {
		try {
			const out = await runCapture("git", ["branch", "--show-current"], 3000);
			return out.stdout.trim();
		} catch {
			return "";
		}
	}

	shutdown(): void {
		this.clearTimers();
		clearTimeout(this.errorTimer);
		clearTimeout(this.hintTimer);
		clearTimeout(this.warmupTimer);
		try {
			this.proc?.kill();
		} catch {
			// Already exited.
		}
		this.removeSessionFiles();
		this.transcriber.shutdown();
		this.state = "idle";
	}
}

type Rows = { render(width: number): string[] };

export default function (pi: ExtensionAPI) {
	let current: VoiceRecorder | null = null;
	const config = loadVoiceConfig();

	const persist = (ctx: { ui: { notify: (m: string, l: "error") => void } }) => {
		try {
			saveVoiceConfig(config);
		} catch {
			ctx.ui.notify("Voice: could not persist voice.json", "error");
		}
	};

	// ponytail: Claude prints /voice output as assistant-style text in the transcript, not a toast.
	pi.registerEntryRenderer<{ text: string }>("voice", (entry, _options, theme) => ({
		render: (width: number) => wrapText(`● ${entry.data?.text ?? ""}`, Math.max(10, width)).map((line, i) => theme.fg("text", i === 0 ? line : `  ${line}`)),
		invalidate() {},
	}));

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (config.enabled && config.hintSessions <= HINT_SESSIONS) {
			config.hintSessions += 1;
			persist(ctx);
		}
		let tui: { requestRender: () => void } | null = null;
		const ui: VoiceUi = {
			paint: (role, text) => ctx.ui.theme.fg(role, text),
			setSlot: (text) => ctx.ui.setStatus("voice", text),
			getEditorText: () => ctx.ui.getEditorText(),
			setEditorText: (text) => ctx.ui.setEditorText(text),
			submit: (text) => pi.sendUserMessage(text),
			requestRender: () => tui?.requestRender(),
		};
		const recorder = new VoiceRecorder(ui, config, ctx.cwd);
		current = recorder;
		const subscribe = (ctx.ui as unknown as { onTerminalInput?: (fn: (data: string) => { consume: true } | undefined) => void }).onTerminalInput;
		if (typeof subscribe !== "function") {
			ctx.ui.notify("Voice disabled: this pi build lacks the terminal input hook", "error");
			return;
		}
		subscribe((data) => recorder.onInput(data));
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((t, theme, keybindings) => {
			tui = t;
			const editor = previous!(t, theme, keybindings) as Rows & ReturnType<NonNullable<typeof previous>>;
			const render = editor.render.bind(editor);
			editor.render = (width: number) => recorder.decorate(render(width), width);
			return editor;
		});
		recorder.init().catch((err: Error) => ctx.ui.notify(`Voice init failed: ${err.message}`, "error"));
	});

	pi.on("session_shutdown", async () => {
		current?.shutdown();
		current = null;
	});

	pi.registerShortcut("alt+r", {
		description: "Voice: tap to start, tap again to send",
		handler: async () => {
			await current?.toggle();
		},
	});

	pi.registerCommand("voice", {
		description: "Voice dictation: /voice [hold|tap|off]",
		handler: async (args, ctx) => {
			const out = voiceCommandOutput((args ?? "").trim().toLowerCase(), config);
			if (out.enabled !== undefined) config.enabled = out.enabled;
			if (out.mode) config.mode = out.mode;
			if (out.enabled !== undefined) persist(ctx);
			pi.appendEntry("voice", { text: out.text });
			current?.refreshHint();
		},
	});
}

if (process.env.VOICE_SELFTEST) {
	const check = (ok: boolean, message: string) => {
		if (!ok) throw new Error(`FAIL: ${message}`);
		console.log(`ok - ${message}`);
	};

	const sample = `[dshow @ 0000022c3ce8a7c0] "Rapoo camera" (video)\n[dshow @ 0000022c3ce8a7c0] "Microphone (Rapoo camera)" (audio)\n[dshow @ 0000022c3ce8a7c0] "Stereo Mix" (audio)`;
	check(JSON.stringify(parseAudioDevices(sample)) === JSON.stringify(["Microphone (Rapoo camera)", "Stereo Mix"]), "parses dshow audio devices");
	check(pickMic(["Microphone (Rapoo camera)", "Stereo Mix"], null) === "Microphone (Rapoo camera)", "prefers microphone device");
	check(pickMic(["Anything"], "Custom mic") === "Custom mic", "override wins");
	check(pickMic([], null) === null, "no devices gives null");
	check(stripWarmupSpaces("hi   ", 5) === "hi", "strips held spaces");
	check(stripWarmupSpaces("hi  ", 1) === "hi ", "respects max count");
	const now = 10_000;
	check(warmupHit([now - 500, now - 300, now - 100, now], now, 4, 600) === true, "four fast spaces is a hold");
	check(warmupHit([now - 900, now - 300, now - 100, now], now, 4, 600) === false, "stale spaces do not count");
	check(cleanTranscript("  Chào\n bạn\r\n") === "Chào bạn", "collapses whitespace incl. Vietnamese");
	const wav = wavFromPcm([Buffer.from([1, 0, 2, 0]), Buffer.from([3, 0])]);
	check(wav.length === 50 && wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(40) === 6 && wav.readUInt32LE(24) === 16000 && wav.readUInt16LE(22) === 1, "wav header: 16 kHz mono 16-bit, data size 6");
	check(wav.readUInt32LE(4) === 42 && wav.readInt16LE(48) === 3, "wav riff size and payload order");

	check(joinAround("refactor the auth middleware to", "use the helper", "") === "refactor the auth middleware to use the helper", "one space after a word");
	check(joinAround("hi ", "there", "") === "hi there", "no double space");
	check(joinAround("", "hello", "") === "hello", "empty anchor no lead");
	check(joinAround("a", "b", "c") === "a b c", "space both sides when text sits inside");
	check(joinAround("a", "", "c") === "ac", "empty transcript inserts nothing");
	check(wordCount("  ") === 0 && wordCount("chào bạn nhé") === 3, "word count");
	check(autoSubmits("làm PR nhé") && !autoSubmits("ok bạn"), "three words submit, two do not");

	const silent = Buffer.alloc(64);
	check(chunkLevel(silent) === 0 && chunkLevel(Buffer.alloc(0)) === 0, "silence is level 0");
	const loud = Buffer.alloc(64);
	for (let i = 0; i < 64; i += 2) loud.writeInt16LE(2000, i);
	check(chunkLevel(loud) === 1, "rms 2000 saturates at 1");
	const quiet = Buffer.alloc(64);
	for (let i = 0; i < 64; i += 2) quiet.writeInt16LE(500, i);
	check(Math.abs(chunkLevel(quiet) - 0.5) < 1e-9, "rms 500 is sqrt(0.25)");
	const s = new LevelSmoother();
	check(Math.abs(s.next(1) - 0.3) < 1e-9 && Math.abs(s.next(1) - 0.51) < 1e-9, "smoother keeps 70%");
	check(levelGlyph(0) === "▁" && levelGlyph(1) === "█" && levelGlyph(0.5) === "▄", "glyph index clamps 1..8");
	check(JSON.stringify(hueRgb(0)) === "[224,82,82]" && JSON.stringify(hueRgb(120)) === "[82,224,82]", "hsl(h,.7,.6) like Claude");
	check(cursorGlyph(0.1, 0.5, 0) === "\x1b[38;2;128;128;128m▄\x1b[39m", "quiet cursor is grey");
	check(cursorGlyph(0.5, 1, 1000).startsWith("\x1b[38;2;") && cursorGlyph(0.5, 1, 1000).endsWith("█\x1b[39m"), "loud cursor is coloured");
	check(pulseGrey(0) === 169 && pulseGrey(500) === 185 && pulseGrey(1500) === 153, "pulse 153..185 over 2s, sine from the midpoint");
	check(processingText(500) === "\x1b[38;2;185;185;185mVoice: processing…\x1b[39m", "processing text");

	const dim = (t: string) => `<${t}>`;
	const rows = ["──", `❯ hello${CURSOR_MARKER}`, "──"];
	const padded = (s: string, w: number) => s + " ".repeat(w - plainWidth(s));
	check(JSON.stringify(voiceRows(rows, " world", "█", 40, dim)) === JSON.stringify(["──", padded("❯ hello< world>█", 40), "──"]), "interim dimmed before the glyph, row padded to width");
	check(JSON.stringify(voiceRows(rows, "", "█", 40, dim)) === JSON.stringify(["──", padded("❯ hello█", 40), "──"]), "no interim, glyph at cursor");
	check(JSON.stringify(voiceRows(rows, " abcdefgh", "█", 12, dim)) === JSON.stringify(["──", "❯ hello< abc>", padded("  <defgh>█", 12), "──"]), "long interim wraps under the prompt");
	check(JSON.stringify(voiceRows(["no cursor"], "x", "█", 40, dim)) === JSON.stringify(["no cursor"]), "rows without a cursor untouched");
	check(voiceRows(rows, "x", CURSOR_MARKER, 40, dim)[1] === padded(`❯ hello<x>${CURSOR_MARKER}`, 40), "processing keeps the real cursor after the interim");
	const paddedRow = [`❯ hello${CURSOR_MARKER}${" ".repeat(33)}`];
	check(plainWidth(voiceRows(paddedRow, "", "█", 40, dim)[0]!) === 40, "pi's padded editor row stays exactly the terminal width");
	check(plainWidth(voiceRows([`${"x".repeat(40)}${CURSOR_MARKER}`], "", "█", 40, dim)[0]!) === 40, "a full row drops the glyph instead of overflowing");

	check(JSON.stringify(wrapText("aa bb cc dd", 5)) === JSON.stringify(["aa bb", "cc dd"]), "wraps on spaces");
	check(JSON.stringify(wrapText("abcdefgh ij", 5)) === JSON.stringify(["abcdefgh", "ij"]), "a word longer than the width stands alone");
	check(wrapText("", 5).length === 0, "empty text wraps to nothing");
	check(wrapText(`● ${enableMessage("tap", null)}`, 120).every((l) => l.length <= 120), "tap message fits 120 columns");

	const cfg = { ...DEFAULT_VOICE_CONFIG };
	check(voiceCommandOutput("hold", cfg).text === "Voice mode enabled (hold). Hold space to record. Dictation language: auto (voice.json to change).", "enable hold text");
	check(voiceCommandOutput("tap", { ...cfg, language: "vi" }).text === "Voice mode enabled (tap). Tap Space (with input empty) to start, tap again to send. Dictation language: vi (voice.json to change).", "enable tap text");
	check(voiceCommandOutput("off", cfg).text === "Voice mode disabled." && voiceCommandOutput("off", cfg).enabled === false, "off text");
	check(voiceCommandOutput("x", cfg).text === 'Unknown mode: "x". Use hold, tap, or off.', "unknown mode");
	check(voiceCommandOutput("", cfg).enabled === false && voiceCommandOutput("", { ...cfg, enabled: false }).enabled === true, "bare /voice toggles");

	const tmp = join(tmpdir(), `pi-voice-test-${Date.now()}.json`);
	const loaded = loadVoiceConfig(tmp);
	check(loaded.mode === "hold" && loaded.hintSessions === 0 && existsSync(tmp), "defaults are created on first run");
	loaded.mode = "tap";
	saveVoiceConfig(loaded, tmp);
	check(loadVoiceConfig(tmp).mode === "tap", "config round-trips");
	unlinkSync(tmp);
	console.log("\nAll voice checks passed.");
}
