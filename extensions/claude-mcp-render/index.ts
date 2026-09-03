import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXPECTED_PARAMS_MARKER = "\n\nExpected parameters:\n";
const PROXY_TOOLS = new Set(["mcp", "mcp_script", "mcpScript"]);

// ponytail: pi-mcp-adapter owns the render of its own tools and offers no hook, so the
// only safe improvement is dropping the schema dump that direct tools append on a
// validation error; the model already holds that schema as the tool's parameters.
export function stripExpectedParameters(text: string): string {
	const index = text.indexOf(EXPECTED_PARAMS_MARKER);
	return index === -1 ? text : text.slice(0, index);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", (event) => {
		if (PROXY_TOOLS.has(event.toolName)) return;
		const block = event.content[0];
		if (!block || block.type !== "text" || !block.text.includes(EXPECTED_PARAMS_MARKER)) return;
		return {
			content: [{ type: "text", text: stripExpectedParameters(block.text) }, ...event.content.slice(1)],
			details: { ...(event.details as Record<string, unknown> | undefined), fullErrorText: block.text },
		};
	});
}

if (process.env.CLAUDE_MCP_RENDER_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(
		stripExpectedParameters(`No iterations found${EXPECTED_PARAMS_MARKER}{"type":"object"}`) === "No iterations found",
		"schema dump removed",
	);
	check(stripExpectedParameters("plain text") === "plain text", "text without dump untouched");
}
