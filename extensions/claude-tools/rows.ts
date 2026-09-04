// ponytail: shared between claude-tools and intent-tools. Claude Code 2.1.260 draws a running tool as a
// blinking grey dot + "Reading a.txt", and a finished read-only tool as one grey line without a dot; only
// Write and Update keep the blue dot and show their content. Measured from a pywinpty capture of the
// dark-daltonized theme, half-second frames. A call counts as running until its result exists, so a
// call waiting for permission still blinks; replayed sessions are seeded from their tool results.
// pi loads every extension through its own module cache, so this file exists once per importer; the
// sets live on globalThis so claude-tools and intent-tools see the same state.
const shared = ((globalThis as any).__claudeRows ??= { finished: new Set<string>(), failed: new Set<string>() }) as {
	finished: Set<string>;
	failed: Set<string>;
};
export const finished = shared.finished;
export const failed = shared.failed;

export const BLINK_MS = 500;

export function blinkOn(now = Date.now()): boolean {
	return Math.floor(now / BLINK_MS) % 2 === 0;
}

export type Component = { render(width: number): string[]; invalidate(): void };

export function dynamic(render: (width: number) => string[]): Component {
	return { render, invalidate() {} };
}

type Entry = { type?: string; message?: { role?: string; toolCallId?: string; isError?: boolean } };

export function seed(entries: Iterable<Entry>): void {
	for (const entry of entries) {
		const message = entry.type === "message" ? entry.message : undefined;
		if (message?.role !== "toolResult" || !message.toolCallId) continue;
		finished.add(message.toolCallId);
		if (message.isError) failed.add(message.toolCallId);
	}
}

export function track(pi: { on: (event: string, handler: (event: any, ctx: any) => void) => void }): void {
	pi.on("session_start", (_event, ctx) => seed(ctx.sessionManager.getEntries()));
	pi.on("tool_execution_start", (event) => {
		finished.delete(event.toolCallId);
		failed.delete(event.toolCallId);
	});
	pi.on("tool_execution_end", (event) => {
		finished.add(event.toolCallId);
		if (event.isError) failed.add(event.toolCallId);
	});
}

if (process.env.CLAUDE_ROWS_SELFTEST) {
	if (!blinkOn(0) || blinkOn(500) || !blinkOn(1000)) throw new Error("FAIL: dot blinks every 500 ms");
	const calls: Record<string, (e: any, ctx: any) => void> = {};
	track({ on: (name, handler) => (calls[name] = handler) });
	calls.tool_execution_start({ toolCallId: "a" }, {});
	if (finished.has("a")) throw new Error("FAIL: a started call is not finished");
	calls.tool_execution_end({ toolCallId: "a", isError: true }, {});
	if (!finished.has("a") || !failed.has("a")) throw new Error("FAIL: end marks finished and records failure");
	seed([{ type: "message", message: { role: "toolResult", toolCallId: "old", isError: false } }, { type: "message", message: { role: "assistant" } }]);
	if (!finished.has("old") || failed.has("old")) throw new Error("FAIL: replayed results count as finished");
	console.log("ok - claude-tools rows");
}
