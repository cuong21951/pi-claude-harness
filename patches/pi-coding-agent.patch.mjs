// Claude Code 2.1.261 look for two things pi-coding-agent draws itself (measured live 2026-09-05):
// 1. a hidden thinking block draws nothing, so tool rows sit one blank line apart (pi drew a spacer
//    plus an empty label line, three blank rows per thinking run);
// 2. an interrupted response ends with grey "  ⎿  Interrupted · What should Claude do instead?"
//    instead of red "Operation aborted".
// The bundle is minified, so this is string surgery on the chunk that holds AssistantMessageComponent.
//   node patches/pi-coding-agent.patch.mjs          apply to every installed pi (idempotent)
//   node patches/pi-coding-agent.patch.mjs --check  exit 1 unless every edit is present everywhere
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INSTALLS = [
	path.join(process.env.APPDATA ?? "", "npm/node_modules/@earendil-works/pi-coding-agent"),
	path.join(process.env.LOCALAPPDATA ?? "", "Volta/tools/image/packages/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-coding-agent"),
];
const MARKER = "let thinkingRunIndex=0;";

const EDITS = [
	[
		'c2.type==="thinking"&&c2.thinking.trim())&&this.contentContainer.addChild(new Spacer(1));let thinkingRunIndex=0;',
		'c2.type==="thinking"&&c2.thinking.trim()&&!(this.hideThinkingBlock&&!this.hiddenThinkingLabel))&&this.contentContainer.addChild(new Spacer(1));let thinkingRunIndex=0;',
	],
	[
		"if(i--,thinkingBlocks.length===0)continue;",
		"if(i--,thinkingBlocks.length===0||this.hideThinkingBlock&&!this.hiddenThinkingLabel)continue;",
	],
	[
		'if(message2.stopReason==="aborted"){let abortMessage=message2.errorMessage&&message2.errorMessage!=="Request was aborted"?message2.errorMessage:"Operation aborted";this.contentContainer.addChild(new Spacer(1)),this.contentContainer.addChild(new Text(theme.fg("error",abortMessage),this.outputPad,0))}',
		'if(message2.stopReason==="aborted"){this.contentContainer.addChild(new Text(theme.fg("muted","  ⎿  Interrupted · What should Claude do instead?"),0,0))}',
	],
	[
		'else if(message2.stopReason==="error"){let errorMsg=message2.errorMessage||"Unknown error";',
		'else if(message2.stopReason==="error"&&message2.errorMessage==="This operation was aborted"){this.contentContainer.addChild(new Text(theme.fg("muted","  ⎿  Interrupted · What should Claude do instead?"),0,0))}else if(message2.stopReason==="error"){let errorMsg=message2.errorMessage||"Unknown error";',
	],
];

const check = process.argv.includes("--check");
let failed = false;
let seen = 0;
for (const install of INSTALLS) {
	const chunks = path.join(install, "dist/bundle/chunks");
	if (!existsSync(chunks)) continue;
	for (const name of readdirSync(chunks)) {
		const file = path.join(chunks, name);
		let src = readFileSync(file, "utf8");
		if (!src.includes(MARKER)) continue;
		seen++;
		let present = 0;
		for (const [from, to] of EDITS) {
			if (src.includes(to)) {
				present++;
				continue;
			}
			const count = src.split(from).length - 1;
			if (count !== 1) {
				console.error(`${file}: expected 1 match, found ${count} for ${from.slice(0, 50)}…`);
				failed = true;
				continue;
			}
			if (!check) {
				src = src.replace(from, to);
				present++;
			}
		}
		if (check) {
			console.log(`${present === EDITS.length ? "ok" : "MISSING"} - ${file}: ${present}/${EDITS.length} edits present`);
			if (present !== EDITS.length) failed = true;
		} else if (!failed) {
			writeFileSync(file, src);
			console.log(`ok - patched ${file}`);
		}
	}
}
if (seen === 0) {
	console.error("no pi-coding-agent chunk with AssistantMessageComponent found");
	failed = true;
}
process.exit(failed ? 1 : 0);
