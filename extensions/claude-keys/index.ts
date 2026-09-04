import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DOUBLE_TAP_WINDOW_MS = 600;

export function secondTap(previousAt: number | null, now: number, windowMs: number): boolean {
	return previousAt !== null && now - previousAt <= windowMs;
}

export type StashResult = { stash: string | null; editor: string; notice: string | null };

export function toggleStash(stash: string | null, editor: string): StashResult {
	if (editor.length > 0) return { stash: editor, editor: "", notice: "Prompt stashed, ctrl+s to restore" };
	if (stash !== null) return { stash: null, editor: stash, notice: null };
	return { stash, editor, notice: null };
}

export default function (pi: ExtensionAPI) {
	let stash: string | null = null;

	// ponytail: "@earendil-works/pi-tui" is a virtual module pi's bundled runtime resolves; plain node
	// (the selftest below) can't resolve it, so matchesKey is loaded lazily here rather than as a
	// top-level import. handleTerminalInput never awaits listeners, so the import happens once up
	// front and the listener itself stays synchronous.
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const { matchesKey } = await import("@earendil-works/pi-tui");
		let lastEscapeAt: number | null = null;

		ctx.ui.onTerminalInput((data: string) => {
			if (!matchesKey(data, "escape")) return undefined;
			if (!ctx.ui.getEditorText() || !ctx.isIdle()) {
				lastEscapeAt = null;
				return undefined;
			}
			const now = Date.now();
			if (secondTap(lastEscapeAt, now, DOUBLE_TAP_WINDOW_MS)) {
				lastEscapeAt = null;
				ctx.ui.setEditorText("");
				return { consume: true };
			}
			lastEscapeAt = now;
			return undefined;
		});
	});

	pi.registerShortcut("ctrl+s", {
		description: "Stash / restore prompt",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			const result = toggleStash(stash, ctx.ui.getEditorText());
			stash = result.stash;
			ctx.ui.setEditorText(result.editor);
			if (result.notice) ctx.ui.notify(result.notice, "info");
		},
	});
}

if (process.env.CLAUDE_KEYS_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	check(secondTap(null, 1000, 600) === false, "no previous tap is not a second tap");
	check(secondTap(1000, 1500, 600) === true, "tap within window counts as second tap");
	check(secondTap(1000, 1700, 600) === false, "tap outside window does not count");
	check(secondTap(1000, 1600, 600) === true, "tap exactly at window edge counts");

	const stashed = toggleStash(null, "hello");
	check(
		stashed.stash === "hello" && stashed.editor === "" && stashed.notice === "Prompt stashed, ctrl+s to restore",
		"stash captures text and clears editor",
	);
	const restored = toggleStash("hello", "");
	check(restored.stash === null && restored.editor === "hello" && restored.notice === null, "restore brings text back and clears stash");
	const noop = toggleStash(null, "");
	check(noop.stash === null && noop.editor === "" && noop.notice === null, "empty editor with no stash is a no-op");
	const overwrite = toggleStash("old", "new");
	check(overwrite.stash === "new" && overwrite.editor === "", "editor text always wins over an existing stash");
}
