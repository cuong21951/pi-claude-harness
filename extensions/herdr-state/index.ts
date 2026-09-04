import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type HerdrKind = "session_start" | "agent_start" | "agent_end" | "session_shutdown";
export type HerdrFacts = { sessionId?: string; sessionFile?: string };

const SOURCE = "herdr:pi";
const AGENT = "pi";

export function herdrPane(env: NodeJS.ProcessEnv): string | undefined {
	if (env.HERDR_ENV !== "1") return undefined;
	const pane = env.HERDR_PANE_ID;
	return pane && pane.trim() !== "" ? pane : undefined;
}

export function herdrArgs(kind: HerdrKind, pane: string, facts: HerdrFacts = {}): string[] {
	const seq = String(Date.now());
	if (kind === "session_start") {
		const args = ["pane", "report-agent-session", pane, "--source", SOURCE, "--agent", AGENT, "--seq", seq];
		if (facts.sessionId) args.push("--agent-session-id", facts.sessionId);
		if (facts.sessionFile) args.push("--agent-session-path", facts.sessionFile);
		return args;
	}
	if (kind === "agent_start" || kind === "agent_end") {
		const state = kind === "agent_start" ? "working" : "idle";
		return ["pane", "report-agent", pane, "--source", SOURCE, "--agent", AGENT, "--state", state, "--seq", seq];
	}
	return ["pane", "release-agent", pane, "--source", SOURCE, "--agent", AGENT, "--seq", seq];
}

function report(kind: HerdrKind, ctx: ExtensionContext): void {
	try {
		const pane = herdrPane(process.env);
		if (!pane) return;
		const facts: HerdrFacts =
			kind === "session_start" ? { sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile() } : {};
		execFile("herdr", herdrArgs(kind, pane, facts), { windowsHide: true }, () => {});
	} catch {
		// fire-and-forget status reporting; never block the event
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => report("session_start", ctx));
	pi.on("agent_start", (_event, ctx) => report("agent_start", ctx));
	pi.on("agent_end", (_event, ctx) => report("agent_end", ctx));
	pi.on("session_shutdown", (_event, ctx) => report("session_shutdown", ctx));
}

if (process.env.HERDR_STATE_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};

	check(herdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w3:pK" }) === "w3:pK", "enabled when HERDR_ENV=1 and pane set");
	check(herdrPane({ HERDR_ENV: "0", HERDR_PANE_ID: "w3:pK" }) === undefined, "disabled when HERDR_ENV is not 1");
	check(herdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "" }) === undefined, "disabled when pane id is empty");
	check(herdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "  " }) === undefined, "disabled when pane id is whitespace");
	check(herdrPane({ HERDR_ENV: "1" }) === undefined, "disabled when pane id is unset");

	const sessionArgs = herdrArgs("session_start", "w3:pK", { sessionId: "sess-1", sessionFile: "C:/sessions/sess-1.jsonl" });
	check(sessionArgs.slice(0, 7).join(" ") === "pane report-agent-session w3:pK --source herdr:pi --agent pi", "session_start command shape");
	check(sessionArgs.includes("--agent-session-id") && sessionArgs[sessionArgs.indexOf("--agent-session-id") + 1] === "sess-1", "session_start carries session id");
	check(
		sessionArgs.includes("--agent-session-path") && sessionArgs[sessionArgs.indexOf("--agent-session-path") + 1] === "C:/sessions/sess-1.jsonl",
		"session_start carries session file",
	);
	check(sessionArgs.includes("--seq"), "session_start carries a seq flag");

	const ephemeralArgs = herdrArgs("session_start", "w3:pK", { sessionId: "sess-2" });
	check(!ephemeralArgs.includes("--agent-session-path"), "session_start without a session file omits the path flag");
	check(ephemeralArgs.includes("--agent-session-id"), "session_start without a session file still carries the session id");

	const startArgs = herdrArgs("agent_start", "w3:pK");
	check(startArgs.join(" ").startsWith("pane report-agent w3:pK --source herdr:pi --agent pi --state working"), "agent_start reports working");

	const endArgs = herdrArgs("agent_end", "w3:pK");
	check(endArgs.join(" ").startsWith("pane report-agent w3:pK --source herdr:pi --agent pi --state idle"), "agent_end reports idle");

	const shutdownArgs = herdrArgs("session_shutdown", "w3:pK");
	check(shutdownArgs.join(" ").startsWith("pane release-agent w3:pK --source herdr:pi --agent pi"), "session_shutdown releases the agent");
	check(!shutdownArgs.includes("--agent-session-id") && !shutdownArgs.includes("--state"), "session_shutdown carries no session or state flags");
}
