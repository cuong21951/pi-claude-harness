import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PI_DIR } from "./pi-dir.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [target] = process.argv.slice(2);

if (target) {
	const { createJiti } = await import(pathToFileURL(path.join(PI_DIR, "node_modules/jiti/lib/jiti-static.mjs")).href);
	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": path.join(PI_DIR, "dist/index.js"),
			"@earendil-works/pi-tui": path.join(PI_DIR, "node_modules/@earendil-works/pi-tui/dist/index.js"),
		},
	});
	await jiti.import(path.resolve(target));
} else {
	const files = fs.readdirSync(path.join(root, "extensions"), { recursive: true })
		.map((f) => path.join(root, "extensions", String(f)))
		.filter((f) => f.endsWith(".ts"));
	let failed = 0;
	for (const file of files) {
		const flag = fs.readFileSync(file, "utf8").match(/process\.env\.([A-Z_]+SELFTEST)/)?.[1];
		const args = file.endsWith("selftest.ts") ? [file] : flag ? [fileURLToPath(import.meta.url), file] : null;
		if (!args) continue;
		const env = { ...process.env, PI_DIR, ...(flag ? { [flag]: "1" } : {}) };
		const run = spawnSync(process.execPath, args, { env, encoding: "utf8" });
		const ok = run.status === 0;
		failed += ok ? 0 : 1;
		console.log(`${ok ? "PASS" : "FAIL"} ${path.relative(root, file)}`);
		if (!ok) console.log(run.stdout, run.stderr);
	}
	for (const name of ["pi-mcp-adapter", "pi-deepseek-search"]) {
		const patch = spawnSync(process.execPath, [path.join(root, `patches/${name}.selftest.ts`)], { env: { ...process.env, PI_DIR }, encoding: "utf8" });
		console.log(`${patch.status === 0 ? "PASS" : "FAIL"} patches/${name}.selftest.ts`);
		if (patch.status !== 0) { failed++; console.log(patch.stdout, patch.stderr); }
	}
	process.exit(failed ? 1 : 0);
}
