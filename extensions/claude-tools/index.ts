import * as os from "node:os";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { callLine, resultText, type Style } from "./format.ts";

// ponytail: only the render slots change; execute, schema and prompt metadata are the built-in definition's.
const DEFINITIONS = {
	read: createReadToolDefinition,
	write: createWriteToolDefinition,
	edit: createEditToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
};

type Theme = { fg: (role: never, text: string) => string; bold: (text: string) => string };

function style(theme: Theme): Style {
	return { fg: (role, text) => theme.fg(role as never, text), bold: (text) => theme.bold(text), home: os.homedir() };
}

export default function (pi: ExtensionAPI) {
	for (const [tool, create] of Object.entries(DEFINITIONS)) {
		const original = create(process.cwd()) as any;
		pi.registerTool({
			...original,
			renderShell: "self",
			renderCall(args: Record<string, unknown>, theme: Theme) {
				return new Text(callLine(tool, args, style(theme)), 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: Theme, context: { args: Record<string, unknown>; isError?: boolean }) {
				const text = result.content
					.filter((block: { type: string }) => block.type === "text")
					.map((block: { text?: string }) => block.text ?? "")
					.join("\n");
				// ponytail: pi reports a failed tool through the render context, not on the result.
				const outcome = { text, isError: result.isError === true || context.isError === true, details: result.details };
				const view = { expanded, isPartial, hint: keyHint("app.tools.expand", "to expand") };
				return new Text(resultText(tool, context.args, outcome, view, style(theme)), 0, 0);
			},
		});
	}
}
