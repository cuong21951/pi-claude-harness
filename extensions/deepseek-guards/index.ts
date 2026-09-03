import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ModelFacts = { id: string; provider: string; input: readonly string[] };

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const REPEAT_LIMIT = 3;

const DESTRUCTIVE = [
	/\bgit\s+checkout\s+(--\s+)?\./,
	/\bgit\s+restore\s+(--\s+)?\./,
	/\bgit\s+clean\s+-[a-z]*f/,
	/\bgit\s+reset\s+--hard/,
	/\bgit\s+push\s+.*--force(?!-with-lease)/,
	/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/,
	/\bRemove-Item\b[^|]*-Recurse[^|]*-Force/i,
];

const SAFEGUARDED = /\bgit\s+stash\b|\bgit\s+commit\b/;

const SCAN_ROOT = /\bfind\s+(\/|[A-Za-z]:[\\/]?|\/[a-z]|~|\$HOME)(\s|$)/;
const DEPTH_LIMIT = /-maxdepth\s+[0-3]\b/;

const LOOP_REASON =
	"Blocked - this exact call already ran twice with the same arguments and returned the same result, " +
	"so a third run cannot produce new information. Use the result you already have, or change approach. " +
	"If you are waiting on something, poll with a different command or ask the user. " +
	"Do not reissue this call verbatim.";

const LOOP_ESCALATION =
	"Blocked again - you have now reissued this identical call after being told it cannot produce new information. " +
	"You are in a loop. Stop calling tools, state plainly what you were trying to learn and why you are stuck, " +
	"and hand control back to the user.";

function destructiveReason(command: string): string {
	return (
		`Blocked - "${command.trim()}" can destroy uncommitted work and nothing in this session has stashed or committed first. ` +
		"Run `git stash -u` (or commit) first, then reissue this command. " +
		"If you believe the working tree is already clean, prove it with `git status --short` and say so to the user before retrying. " +
		"Do not route around this with a different shell, a script file, or another tool."
	);
}

function normalize(value: unknown): unknown {
	if (typeof value === "string") return value.trim();
	if (Array.isArray(value)) return value.map(normalize);
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		return Object.fromEntries(Object.keys(source).sort().map((key) => [key, normalize(source[key])]));
	}
	return value;
}

function bareCommand(command: string): string {
	return command.trim().replace(/^rtk\s+/, "");
}

function callKey(name: string, input: unknown): string {
	const source = input as Record<string, unknown>;
	const keyed =
		name === "bash" && typeof source?.command === "string"
			? { ...source, command: bareCommand(source.command) }
			: input;
	return `${name}\u0000${JSON.stringify(normalize(keyed))}`;
}

function isDestructive(command: string): boolean {
	const bare = bareCommand(command);
	return DESTRUCTIVE.some((pattern) => pattern.test(bare));
}

function isUnboundedScan(command: string): boolean {
	return bareCommand(command)
		.split(/[;|&]+/)
		.some((segment) => SCAN_ROOT.test(segment) && !DEPTH_LIMIT.test(segment));
}

function scanReason(command: string): string {
	return (
		`Blocked - "${command.trim()}" walks the whole drive. On this machine that took 5.8 hours once and returned nothing. ` +
		"Search the working directory instead (`rtk rg -n <pattern>`, or `find . -name ...`), and if you truly need a wider sweep " +
		"give it a root and `-maxdepth 3`. Config that proves a contract lives in the repo you are working in - look there first."
	);
}

function blockedImageRead(path: string, modelInput: readonly string[] | undefined): boolean {
	if (!IMAGE_FILE.test(path.trim())) return false;
	return !modelInput?.includes("image");
}

function imageCapableIds(scoped: readonly { model: ModelFacts }[] | undefined): string[] {
	if (!Array.isArray(scoped)) return [];
	return scoped
		.filter((entry) => entry?.model?.input?.includes("image"))
		.map((entry) => `${entry.model.provider}/${entry.model.id}`);
}

function imageReason(capable: readonly string[]): string {
	return (
		"Blocked - this model has no image input and will invent a confident description if it tries. " +
		(capable.length > 0
			? `Switch to an image-capable model with Ctrl+P (${capable.join(", ")}) and read the file there, or ask the user to describe it. `
			: "No image-capable model is configured in this pi install, so there is nothing to switch to. Tell the user plainly that you cannot see the image and ask them to describe it or to run this task in Claude Code. ") +
		"Do not describe, summarize, or reason about this image on the current model, and do not route around this with bash, base64, or another tool."
	);
}

let last = { key: "", count: 0 };
let safeguarded = false;

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", () => {
		last = { key: "", count: 0 };
		safeguarded = false;
	});

	pi.on("tool_call", (event, ctx) => {
		let key = "";
		try {
			if (isToolCallEventType("read", event) && blockedImageRead(event.input.path, ctx.model?.input)) {
				return { block: true, reason: imageReason(imageCapableIds(ctx.scopedModels)) };
			}

			if (isToolCallEventType("bash", event)) {
				const command = event.input.command ?? "";
				if (SAFEGUARDED.test(bareCommand(command))) safeguarded = true;
				if (!safeguarded && isDestructive(command)) {
					return { block: true, reason: destructiveReason(command) };
				}
				if (isUnboundedScan(command)) {
					return { block: true, reason: scanReason(command) };
				}
			}

			key = callKey(event.toolName, event.input);
		} catch {
			if (isToolCallEventType("read", event) && IMAGE_FILE.test(String(event.input?.path ?? ""))) {
				return { block: true, reason: imageReason([]) };
			}
			return undefined;
		}

		last = key === last.key ? { key, count: last.count + 1 } : { key, count: 1 };
		if (last.count < REPEAT_LIMIT) return undefined;
		return { block: true, reason: last.count > REPEAT_LIMIT ? LOOP_ESCALATION : LOOP_REASON };
	});
}

if (process.env.DEEPSEEK_GUARDS_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(
		callKey("bash", { command: "git status --short ", cwd: "C:/TimeBlock" }) ===
			callKey("bash", { cwd: "C:/TimeBlock", command: "git status --short" }),
		"key order and surrounding whitespace do not change the call key",
	);
	check(
		callKey("bash", { command: "git status --short" }) !== callKey("bash", { command: "git diff --short" }),
		"different arguments produce different call keys",
	);
	check(
		callKey("bash", { command: "rtk git status" }) === callKey("bash", { command: "git status" }),
		"rtk-rewritten and bare commands share one loop key",
	);
	check(blockedImageRead("C:/scratch/Screenshot.PNG", ["text"]), "uppercase .PNG blocks on a text-only model");
	check(!blockedImageRead("C:/scratch/screenshot.png", ["text", "image"]), ".png allowed on an image-capable model");
	check(!blockedImageRead("C:/TimeBlock/Program.cs", ["text"]), "non-image path allowed on a text-only model");
	check(blockedImageRead("C:/scratch/a.png", undefined), "unknown model capability fails closed on images");
	check(imageCapableIds(undefined).length === 0, "undefined scopedModels does not throw");

	check(isDestructive("git checkout ."), "git checkout . is destructive");
	check(isDestructive("rtk git clean -fd"), "rtk-prefixed git clean -fd is destructive");
	check(isDestructive("git reset --hard HEAD~1"), "git reset --hard is destructive");
	check(isDestructive("rm -rf build"), "rm -rf is destructive");
	check(!isDestructive("git checkout develop"), "switching branches is not destructive");
	check(!isDestructive("git push --force-with-lease"), "force-with-lease is not destructive");
	check(!isDestructive("git status --short"), "git status is not destructive");

	check(isUnboundedScan("find / -name \"NuGet.config\""), "find / is an unbounded scan");
	check(
		isUnboundedScan("find / -name \"NuGet.config\" 2>/dev/null | head -3; find /c/Users/me -maxdepth 2 -name x"),
		"a bounded find later in the line does not excuse the unbounded one before it",
	);
	check(isUnboundedScan("find C:/ -name web.config"), "a drive root is an unbounded scan");
	check(isUnboundedScan("find ~ -name settings.json"), "the home directory is an unbounded scan");
	check(!isUnboundedScan("find . -name web.config"), "searching the working directory is allowed");
	check(!isUnboundedScan("find /c/TimeBlock -maxdepth 3 -name AGENTS.md"), "a depth-limited sweep is allowed");
	check(!isUnboundedScan("rtk rg -n apiVersion src"), "ripgrep in the repo is allowed");

	let seen = "";
	const fake = { key: "", count: 0 };
	for (let i = 0; i < 6; i++) {
		const k = callKey("bash", { command: "git status" });
		Object.assign(fake, k === fake.key ? { key: k, count: fake.count + 1 } : { key: k, count: 1 });
		seen += fake.count >= REPEAT_LIMIT ? "B" : ".";
	}
	check(seen === "..BBBB", `loop breaker latches instead of resetting (got ${seen})`);
}
