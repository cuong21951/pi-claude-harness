import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ponytail: pi's package manifest carries extensions/skills/prompts/themes; everything else
// (agents, guard configs, keybindings, AGENTS.md, settings) is copied once, never overwritten.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");

const copyOnce = [
	"AGENTS.md",
	"keybindings.json",
	"models.json",
	"cheap-models.json",
	"auto-fallback.json",
	"subagents.json",
	"extensions/pi-permission-system/config.json",
	"agents/scout.md",
	"agents/planner.md",
	"agents/worker.md",
	"agents/reviewer.md",
];
for (const rel of copyOnce) {
	const target = path.join(agentDir, rel);
	if (fs.existsSync(target)) {
		console.log(`keep    ${rel} (exists)`);
		continue;
	}
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.copyFileSync(path.join(repo, rel), target);
	console.log(`copied  ${rel}`);
}

const settingsPath = path.join(agentDir, "settings.json");
const example = JSON.parse(fs.readFileSync(path.join(repo, "settings.example.json"), "utf8"));
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
for (const [key, value] of Object.entries(example)) {
	if (key === "packages") continue;
	if (!(key in settings)) settings[key] = value;
}
settings.packages = [...new Set([...(settings.packages ?? []), ...example.packages])];
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`merged  settings.json (${settings.packages.length} packages)`);
console.log("\nNext: run `pi install` once so the npm/git packages are fetched, then start `pi`.");
console.log("Optional: apply patches/pi-mcp-adapter.patch for Claude-style MCP rows (see patches/README.md).");
