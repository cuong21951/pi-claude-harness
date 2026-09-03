import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BLOCK_START = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||<|\s{4})/;

// ponytail: Claude Code prefixes assistant text with "● "; only a plain paragraph gets it so markdown blocks stay valid.
export function bulletize(markdown: string): string {
	const start = markdown.search(/\S/);
	if (start === -1) return markdown;
	const body = markdown.slice(start);
	if (BLOCK_START.test(body) || body.startsWith("● ")) return markdown;
	return `${markdown.slice(0, start)}● ${body}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerMarkdownTransformer((markdown, { messageType }) => (messageType === "assistant" ? bulletize(markdown) : markdown));
	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setHiddenThinkingLabel("✻ Thought");
	});
}

if (process.env.CLAUDE_MESSAGES_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(bulletize("Hello world") === "● Hello world", "paragraph gets bullet");
	check(bulletize("\n\nHello") === "\n\n● Hello", "leading whitespace kept");
	check(bulletize("# Title\ntext") === "# Title\ntext", "heading untouched");
	check(bulletize("- item") === "- item", "list untouched");
	check(bulletize("1. item") === "1. item", "ordered list untouched");
	check(bulletize("```ts\nx\n```") === "```ts\nx\n```", "code fence untouched");
	check(bulletize("● already") === "● already", "idempotent");
	check(bulletize("") === "", "empty");
}
