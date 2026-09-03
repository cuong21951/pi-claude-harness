import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TIMEBLOCK_ROOT = "c:\\timeblock\\";
const CODE_EXTENSIONS = [".cs", ".ts", ".js", ".tsx"];

const REASON =
	'ReviewTaste.MD "Minimal Diff, No Code Comments" bans comments in shipped TimeBlockr code. ' +
	"Remove them and rewrite the intent into naming and small functions. Only `///` XML doc stays legal. " +
	"Do not route around this with bash or any other tool — write the file without the comment.";

function addedComments(newText: string, oldText: string): string[] {
	const existing = new Set(oldText.split("\n").map((line) => line.trim()));
	return newText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("//") && !line.startsWith("///") && !existing.has(line));
}

function underTimeblock(absolutePath: string): boolean {
	return `${absolutePath.toLowerCase().replace(/\//g, "\\")}\\`.startsWith(TIMEBLOCK_ROOT);
}

function timeblockCodePath(rawPath: string, cwd: string): string | undefined {
	const absolute = resolve(cwd, rawPath.replace(/^@/, ""))
		.toLowerCase()
		.replace(/\//g, "\\");
	if (!underTimeblock(absolute)) return undefined;
	return CODE_EXTENSIONS.some((extension) => absolute.endsWith(extension)) ? absolute : undefined;
}

function currentContent(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		try {
			let target: string | undefined;
			let added: string[];

			if (isToolCallEventType("edit", event)) {
				target = timeblockCodePath(event.input.path, ctx.cwd);
				if (!target) return undefined;
				added = event.input.edits.flatMap((edit) => addedComments(edit.newText, edit.oldText));
			} else if (isToolCallEventType("write", event)) {
				target = timeblockCodePath(event.input.path, ctx.cwd);
				if (!target) return undefined;
				added = addedComments(event.input.content, currentContent(target));
			} else if (isToolCallEventType("bash", event)) {
				const command = event.input.command;
				if (!underTimeblock(resolve(ctx.cwd))) return undefined;
				if (!CODE_EXTENSIONS.some((extension) => command.includes(extension))) return undefined;
				target = "this bash command";
				added = addedComments(command, "");
			} else {
				return undefined;
			}

			if (added.length === 0) return undefined;
			return { block: true, reason: `Blocked — new code comments in ${target}:\n${added.join("\n")}\n${REASON}` };
		} catch {
			return undefined;
		}
	});
}
