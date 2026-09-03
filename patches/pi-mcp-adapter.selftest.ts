import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const mod = await jiti.import(path.join(agentDir, "npm/node_modules/pi-mcp-adapter/tool-result-renderer.ts"));
const {
  createMcpDirectToolCallRenderer,
  createMcpProxyToolCallRenderer,
  createMcpToolResultRenderer,
  resolveMcpToolRenderOptions,
} = mod;

const plainTheme = { fg: (_r, t) => t, bold: (t) => t };

const compactOptions = resolveMcpToolRenderOptions({ toolResultRendering: "compact" });
const boxedOptions = resolveMcpToolRenderOptions({ toolResultRendering: "boxed" });

function makeResult(text, details = { mode: "call", server: "azure-devops-tbr", tool: "pipelines_write" }) {
  return {
    content: text === undefined ? [] : [{ type: "text", text }],
    details,
  };
}

function makeContext(isError = false) {
  return { isError, state: {} };
}

function runCall(renderer, args, context) {
  return renderer(args, plainTheme, context);
}

function runResult(resultRenderer, result, options, context) {
  const component = resultRenderer(result, options, plainTheme, context);
  return component.render(200).map((line) => line.trimEnd()).join("\n");
}

// --- Direct tool, 2 args ---
{
  const renderCall = createMcpDirectToolCallRenderer("azure-devops-tbr_pipelines_write", "azure-devops-tbr", "pipelines_write", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { action: "update_build", buildId: 512 }, context);
  assert.equal(context.state.compactTitle, "azure-devops-tbr - pipelines_write (MCP)");
  assert.equal(context.state.compactInputPreview, '(action: "update_build", buildId: 512)');

  const row = runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: false }, context);
  assert.equal(row, '● azure-devops-tbr - pipelines_write (MCP)(action: "update_build", buildId: 512)\n  └ Build 512 queued');
  console.log("PASS: direct tool 2 args ->", JSON.stringify(row));
}

// --- Direct tool, 6 args (shows 4 then …) ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const context = makeContext();
  runCall(renderCall, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, context);
  assert.equal(context.state.compactInputPreview, "(a: 1, b: 2, c: 3, d: 4, …)");
  console.log("PASS: 6 args ->", context.state.compactInputPreview);
}

// --- Direct tool, no args ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, {}, context);
  assert.equal(context.state.compactTitle, "srv - tool (MCP)");
  assert.equal(context.state.compactInputPreview, "");
  const row = runResult(renderResult, makeResult("ok"), { isPartial: false, expanded: false }, context);
  assert.equal(row, "● srv - tool (MCP)\n  └ ok");
  console.log("PASS: no args ->", JSON.stringify(row));
}

// --- Proxy "mcp call" row (tool embeds server_tool, no explicit server) ---
{
  const renderCall = createMcpProxyToolCallRenderer(compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { tool: "azure-devops-tbr_pipelines_write", args: { action: "update_build", buildId: 512 } }, context);
  assert.equal(context.state.compactTitle, "azure-devops-tbr - pipelines_write (MCP)");
  assert.equal(context.state.compactInputPreview, '(action: "update_build", buildId: 512)');
  const row = runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: false }, context);
  assert.equal(row, '● azure-devops-tbr - pipelines_write (MCP)(action: "update_build", buildId: 512)\n  └ Build 512 queued');
  console.log("PASS: proxy mcp call ->", JSON.stringify(row));
}

// --- Proxy "mcp call ... @ server" (explicit server) ---
{
  const renderCall = createMcpProxyToolCallRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { tool: "pipelines_write", server: "azure-devops-tbr", args: { action: "update_build" } }, context);
  assert.equal(context.state.compactTitle, "azure-devops-tbr - pipelines_write (MCP)");
  console.log("PASS: proxy mcp call @ server ->", context.state.compactTitle);
}

// --- Other proxy action (mcp search) keeps its text, gets bullet ---
{
  const renderCall = createMcpProxyToolCallRenderer(compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { search: "pipelines" }, context);
  assert.equal(context.state.compactTitle, "mcp search pipelines");
  assert.equal(context.state.compactInputPreview, "");
  const row = runResult(renderResult, makeResult("found 3", { mode: "search" }), { isPartial: false, expanded: false }, context);
  assert.equal(row, "● mcp search pipelines\n  └ found 3");
  console.log("PASS: mcp search ->", JSON.stringify(row));
}

// --- Collapsed result: 1 line, no hint ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, {}, context);
  const row = runResult(renderResult, makeResult("single line result"), { isPartial: false, expanded: false }, context);
  assert.equal(row, "● srv - tool (MCP)\n  └ single line result");
  console.log("PASS: collapsed 1 line ->", JSON.stringify(row));
}

// --- Collapsed result: 5 lines total, collapsedResultLines=1 -> hint text ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, {}, context);
  const text = ["line1", "line2", "line3", "line4", "line5"].join("\n");
  const row = runResult(renderResult, makeResult(text), { isPartial: false, expanded: false }, context);
  assert.equal(row, "● srv - tool (MCP)\n  └ line1 … +4 lines (ctrl+o to expand)");
  console.log("PASS: 5 lines hint ->", JSON.stringify(row));
}

// --- Error result ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext(true);
  runCall(renderCall, {}, context);
  const result = makeResult("Error: boom\nstack trace line 2", { mode: "call", server: "srv", tool: "tool", error: true });
  const row = runResult(renderResult, result, { isPartial: false, expanded: false }, context);
  assert.equal(row, "● srv - tool (MCP)\n  └ ✗ Error: boom");
  console.log("PASS: error result ->", JSON.stringify(row));
}

// --- Expanded output ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, {}, context);
  const text = ["line1", "line2", "line3"].join("\n");
  const row = runResult(renderResult, makeResult(text), { isPartial: false, expanded: true }, context);
  assert.equal(row, "● srv - tool (MCP)\n    line1\n    line2\n    line3");
  console.log("PASS: expanded ->", JSON.stringify(row));
}

// --- Partial (still running) ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { action: "update_build" }, context);
  const row = runResult(renderResult, makeResult(undefined), { isPartial: true, expanded: false }, context);
  assert.equal(row, '● srv - tool (MCP)(action: "update_build")\n  └ …');
  console.log("PASS: partial ->", JSON.stringify(row));
}

// --- Empty result ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, {}, context);
  const row = runResult(renderResult, makeResult(undefined), { isPartial: false, expanded: false }, context);
  assert.equal(row, "● srv - tool (MCP)\n  └ (empty result)");
  console.log("PASS: empty result ->", JSON.stringify(row));
}

// --- Boxed mode unchanged: uses "MCP server/tool" identity line, no bullet, no └ ---
{
  const renderCall = createMcpDirectToolCallRenderer("azure-devops-tbr_pipelines_write", "azure-devops-tbr", "pipelines_write", boxedOptions);
  const renderResult = createMcpToolResultRenderer(boxedOptions);
  const context = makeContext();
  const callComponent = runCall(renderCall, { action: "update_build", buildId: 512 }, context);
  const callLines = callComponent.render(200).map((line) => line.trimEnd()).join("\n");
  assert.equal(callLines, 'azure-devops-tbr_pipelines_write\n{\n  "action": "update_build",\n  "buildId": 512\n}');
  const row = runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: false }, context);
  assert.equal(row, "MCP azure-devops-tbr/pipelines_write\nBuild 512 queued");
  console.log("PASS: boxed mode unchanged ->", JSON.stringify(row));
}

console.log("\nAll selftest assertions passed.");
