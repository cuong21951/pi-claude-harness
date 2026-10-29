import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PI_DIR } from "../scripts/pi-dir.mjs";

const { createJiti } = await import(pathToFileURL(path.join(PI_DIR, "node_modules/jiti/lib/jiti-static.mjs")).href);
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": path.join(PI_DIR, "dist/index.js"),
    "@earendil-works/pi-tui": path.join(PI_DIR, "node_modules/@earendil-works/pi-tui/dist/index.js"),
    "@earendil-works/pi-ai/compat": path.join(PI_DIR, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
    "@earendil-works/pi-ai": path.join(PI_DIR, "node_modules/@earendil-works/pi-ai/dist/index.js"),
  },
});

const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi/agent");
const mod = await jiti.import(path.join(agentDir, "npm/node_modules/pi-web-access/index.ts"));
const { claudeDot, default: extension } = mod;

const tagged = { fg: (role, text) => `<${role}>${text}</${role}>`, bold: (text) => `<b>${text}</b>` };
const plain = { fg: (_role, text) => text, bold: (text) => text };
const render = (component, width = 200) => component.render(width).map((line) => line.trimEnd()).join("\n");

const tools = [];
const fake = new Proxy(
  { registerTool: (definition) => tools.push(definition), on: () => {}, registerCommand: () => {}, registerShortcut: () => {}, registerMessageRenderer: () => {} },
  { get: (target, key) => (key in target ? target[key] : () => undefined) },
);
extension(fake);
const tool = tools.find((t) => t.label === "Fetch Content");
assert.ok(tool, "fetch tool registered");
assert.equal(tool.renderShell, "self");

const rows = (globalThis.__claudeRows ??= { finished: new Set(), failed: new Set() });

{
  const row = render(tool.renderCall({ url: "https://example.com" }, tagged, { toolCallId: "run" }));
  assert.ok(row === "<muted>● </muted><toolTitle><b>Fetch</b></toolTitle><toolTitle>(https://example.com)</toolTitle>" || row === "  <toolTitle><b>Fetch</b></toolTitle><toolTitle>(https://example.com)</toolTitle>", row);
  console.log("PASS: running call blinks a grey dot ->", JSON.stringify(row));
}
{
  assert.equal(claudeDot("x", tagged, 0), "<muted>● </muted>");
  assert.equal(claudeDot("x", tagged, 500), "  ");
  rows.finished.add("done");
  assert.equal(claudeDot("done", tagged, 500), "<borderAccent>● </borderAccent>");
  console.log("PASS: dot blinks every 500 ms, blue once finished");
}
{
  const row = render(tool.renderCall({ urls: ["https://a", "https://b"] }, plain, { toolCallId: "m" }));
  assert.ok(row.endsWith("Fetch(2 URLs)"), row);
  console.log("PASS: several urls ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult({ content: [], details: {} }, { expanded: false, isPartial: true }, tagged, {}));
  assert.equal(row, "<muted>  ⎿  </muted><muted>Fetching…</muted>");
  console.log("PASS: partial ->", JSON.stringify(row));
}
{
  const result = { content: [{ type: "text", text: "# Example Domain\nbody" }], details: { urlCount: 1, successful: 1, totalChars: 559 } };
  const row = render(tool.renderResult(result, { expanded: false, isPartial: false }, tagged, {}));
  assert.equal(row, "<muted>  ⎿  </muted><toolTitle>Received </toolTitle><toolTitle><b>559 chars</b></toolTitle><toolTitle></toolTitle>");
  const expanded = render(tool.renderResult(result, { expanded: true, isPartial: false }, plain, {}));
  assert.equal(expanded, "  ⎿  Received 559 chars\n     # Example Domain\n     body");
  console.log("PASS: finished ->", JSON.stringify(row));
}
{
  const result = { content: [{ type: "text", text: "Error: boom" }], details: { error: "boom" } };
  const row = render(tool.renderResult(result, { expanded: false, isPartial: false }, tagged, { isError: true }));
  assert.equal(row, "<muted>  ⎿  </muted><error>Error: boom</error>");
  console.log("PASS: error ->", JSON.stringify(row));
}
{
  const result = { content: [{ type: "text", text: "a\nb" }], details: { urlCount: 3, successful: 2, totalChars: 1200 } };
  const row = render(tool.renderResult(result, { expanded: false, isPartial: false }, plain, {}));
  assert.equal(row, "  ⎿  Received 1200 chars from 2/3 URLs");
  console.log("PASS: several urls result ->", JSON.stringify(row));
}
console.log("ok - pi-web-access fetch rows");
