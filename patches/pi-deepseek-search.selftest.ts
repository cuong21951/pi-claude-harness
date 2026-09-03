import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PI_DIR } from "../scripts/pi-dir.mjs";

const { createJiti } = await import(
  pathToFileURL(path.join(PI_DIR, "node_modules/jiti/lib/jiti-static.mjs")).href
);
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": path.join(PI_DIR, "dist/index.js"),
    "@earendil-works/pi-tui": path.join(PI_DIR, "node_modules/@earendil-works/pi-tui/dist/index.js"),
  },
});

const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi/agent");
const mod = await jiti.import(path.join(agentDir, "npm/node_modules/pi-deepseek-search/index.ts"));
const { cleanAnswer, searchSummary, default: extension } = mod;

const plainTheme = { fg: (_r, t) => t, bold: (t) => t };

async function captureTool() {
  let handler;
  let tool;
  extension({
    on: (event, fn) => {
      if (event === "session_start") handler = fn;
    },
    registerTool: (definition) => {
      tool = definition;
    },
  });
  await handler({}, { modelRegistry: { getApiKeyForProvider: async () => "test-key" } });
  return tool;
}

function render(component) {
  return component.render(200).map((line) => line.trimEnd()).join("\n");
}

const tool = await captureTool();
assert.equal(tool.name, "web_search");
assert.equal(tool.renderShell, "self");

// --- call line ---
{
  const row = render(tool.renderCall({ query: "claude code hooks" }, plainTheme));
  assert.equal(row, '● Web Search("claude code hooks")');
  console.log("PASS: call line ->", JSON.stringify(row));
}
{
  const row = render(tool.renderCall({ query: "x", allowed_domains: ["a.com", "b.com"] }, plainTheme));
  assert.equal(row, '● Web Search("x") +2d');
  console.log("PASS: domain tag ->", JSON.stringify(row));
}
{
  const row = render(tool.renderCall({}, plainTheme));
  assert.equal(row, '● Web Search("...")');
  console.log("PASS: missing query ->", JSON.stringify(row));
}

// --- result rows ---
const answer = "Line one\nLine two\n\nLinks:\n1. [t](u)\n\nREMINDER: cite them";
const result = (text, details, isError = false) => ({ content: [{ type: "text", text }], details, isError });
const view = (expanded = false, isPartial = false) => ({ expanded, isPartial });

{
  const row = render(tool.renderResult(result(answer, { sources: [1, 2], durationMs: 3400 }), view(), plainTheme));
  assert.equal(row, "  └ Did 1 search in 3s (2 sources) (ctrl+o to expand)");
  console.log("PASS: collapsed ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult(result(answer, { sources: [1], durationMs: 900 }), view(), plainTheme));
  assert.equal(row, "  └ Did 1 search in 1s (1 source) (ctrl+o to expand)");
  console.log("PASS: singular and sub-second ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult(result("body", undefined), view(), plainTheme));
  assert.equal(row, "  └ Did 1 search (ctrl+o to expand)");
  console.log("PASS: no details ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult(result(answer, { sources: [], durationMs: 2000 }), view(true), plainTheme));
  assert.equal(
    row,
    "  └ Did 1 search in 2s\n    Line one\n    Line two\n\n    Links:\n    1. [t](u)",
  );
  console.log("PASS: expanded body indented ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult(result("Search failed: DeepSeek API 401\nmore", undefined, true), view(), plainTheme));
  assert.equal(row, "  └ ✗ Search failed: DeepSeek API 401");
  console.log("PASS: error first line ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult(result("Found 10 results…", undefined), view(false, true), plainTheme));
  assert.equal(row, "  └ Found 10 results…");
  console.log("PASS: partial progress ->", JSON.stringify(row));
}
{
  const row = render(tool.renderResult(result("", undefined), view(false, true), plainTheme));
  assert.equal(row, "  └ …");
  console.log("PASS: empty partial ->", JSON.stringify(row));
}

// --- pure helpers ---
assert.equal(cleanAnswer("a\n\nREMINDER: x"), "a");
assert.equal(cleanAnswer('a<invoke name="x">b'), "ab");
assert.equal(searchSummary({ durationMs: 12_000 }, 0), "Did 1 search in 12s");
console.log("PASS: helpers");

console.log("\nAll pi-deepseek-search render checks passed.");
