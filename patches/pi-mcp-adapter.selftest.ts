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
const taggedTheme = { fg: (r, t) => `<${r}>${t}</${r}>`, bold: (t) => t };

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

function runCall(renderer, args, context, theme = plainTheme) {
  return renderer(args, theme, context);
}

function runResult(resultRenderer, result, options, context, theme = plainTheme) {
  const component = resultRenderer(result, options, theme, context);
  return component.render(200).map((line) => line.trimEnd()).join("\n");
}

// Claude Code 2.1.261, measured live: running = blinking grey dot + "Calling <server>…", finished = grey
// "Called <server>", no result preview; ctrl+o expands to the full row. Errors keep the row (unmeasured).

// --- Direct tool, 2 args: collapsed is one grey line, expanded is the full row ---
{
  const renderCall = createMcpDirectToolCallRenderer("azure-devops-tbr_pipelines_write", "azure-devops-tbr", "pipelines_write", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { action: "update_build", buildId: 512 }, context);
  assert.equal(context.state.compactTitle, "azure-devops-tbr - pipelines_write (MCP)");
  assert.equal(context.state.compactInputPreview, '(action: "update_build", buildId: 512)');
  assert.equal(context.state.compactServer, "azure-devops-tbr");

  const done = runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: false }, context);
  assert.equal(done, "Called azure-devops-tbr");
  const painted = runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: false }, context, taggedTheme);
  assert.equal(painted, "<muted>Called azure-devops-tbr</muted>");
  const expanded = runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: true }, context);
  assert.equal(expanded, '● azure-devops-tbr - pipelines_write (MCP)(action: "update_build", buildId: 512)\n     Build 512 queued');
  console.log("PASS: direct tool ->", JSON.stringify(done), "/", JSON.stringify(expanded));
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
  assert.equal(runResult(renderResult, makeResult("ok"), { isPartial: false, expanded: false }, context), "Called srv");
  assert.equal(runResult(renderResult, makeResult("ok"), { isPartial: false, expanded: true }, context), "● srv - tool (MCP)\n     ok");
  console.log("PASS: no args");
}

// --- Proxy "mcp call" row (tool embeds server_tool, no explicit server) ---
{
  const renderCall = createMcpProxyToolCallRenderer(compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { tool: "azure-devops-tbr_pipelines_write", args: { action: "update_build", buildId: 512 } }, context);
  assert.equal(context.state.compactTitle, "azure-devops-tbr - pipelines_write (MCP)");
  assert.equal(context.state.compactInputPreview, '(action: "update_build", buildId: 512)');
  assert.equal(runResult(renderResult, makeResult("Build 512 queued"), { isPartial: false, expanded: false }, context), "Called azure-devops-tbr");
  console.log("PASS: proxy mcp call");
}

// --- Proxy "mcp call ... @ server" (explicit server) ---
{
  const renderCall = createMcpProxyToolCallRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { tool: "pipelines_write", server: "azure-devops-tbr", args: { action: "update_build" } }, context);
  assert.equal(context.state.compactTitle, "azure-devops-tbr - pipelines_write (MCP)");
  assert.equal(context.state.compactServer, "azure-devops-tbr");
  console.log("PASS: proxy mcp call @ server");
}

// --- Other proxy action (mcp search) has no server: its text is the grey line ---
{
  const renderCall = createMcpProxyToolCallRenderer(compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { search: "pipelines" }, context);
  assert.equal(context.state.compactTitle, "mcp search pipelines");
  assert.equal(context.state.compactServer, undefined);
  const row = runResult(renderResult, makeResult("found 3", { mode: "search" }), { isPartial: false, expanded: false }, context);
  assert.equal(row, "mcp search pipelines");
  console.log("PASS: mcp search ->", JSON.stringify(row));
}

// --- Result without call state (replayed session) takes the server from the details ---
{
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const row = runResult(renderResult, makeResult("ok", { mode: "call", server: "dse", tool: "list" }), { isPartial: false, expanded: false }, { isError: false });
  assert.equal(row, "Called dse");
  console.log("PASS: replayed result ->", JSON.stringify(row));
}

// --- Error result: row stays, elbow + red first line, no ✗ ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext(true);
  const callComponent = runCall(renderCall, { q: 1 }, context);
  assert.deepEqual(callComponent.render(200), [], "compact call block never prints, even on error");
  const result = makeResult("Error: boom\nstack trace line 2", { mode: "call", server: "srv", tool: "tool", error: true });
  const row = runResult(renderResult, result, { isPartial: false, expanded: false }, context);
  assert.equal(row, "● srv - tool (MCP)(q: 1)\n  ⎿  Error: boom");
  const painted = runResult(renderResult, result, { isPartial: false, expanded: false }, context, taggedTheme);
  assert.ok(painted.endsWith("<error>  ⎿  Error: boom</error>"), "error row painted error");
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
  assert.equal(row, "● srv - tool (MCP)\n     line1\n     line2\n     line3");
  console.log("PASS: expanded ->", JSON.stringify(row));
}

// --- Partial (still running): blinking grey dot + Calling server… ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, { action: "update_build" }, context);
  const row = runResult(renderResult, makeResult(undefined), { isPartial: true, expanded: false }, context, taggedTheme);
  assert.match(row, /^(<muted>● <\/muted>|  )Calling srv…$/);
  console.log("PASS: partial ->", JSON.stringify(row));
}

// --- Empty result ---
{
  const renderCall = createMcpDirectToolCallRenderer("srv_tool", "srv", "tool", compactOptions);
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = makeContext();
  runCall(renderCall, {}, context);
  assert.equal(runResult(renderResult, makeResult(undefined), { isPartial: false, expanded: false }, context), "Called srv");
  assert.equal(runResult(renderResult, makeResult(undefined), { isPartial: false, expanded: true }, context), "● srv - tool (MCP)\n     (empty result)");
  console.log("PASS: empty result");
}

// --- Boxed mode unchanged: uses "MCP server/tool" identity line, no bullet, no elbow ---
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

// --- Grouping through claude-tools: two calls to one server collapse into Claude's "Called dse 2 times" ---
{
  const rows = await jiti.import(path.join(path.dirname(fileURLToPath(import.meta.url)), "../extensions/claude-tools/rows.ts"));
  const calls = {};
  rows.track({ on: (name, handler) => (calls[name] = handler) });
  calls.agent_start({}, {});
  const renderResult = createMcpToolResultRenderer(compactOptions);
  const context = (id) => ({ isError: false, state: {}, toolCallId: id, invalidate() {} });
  const first = context("mcp-1");
  const second = context("mcp-2");
  calls.tool_execution_start({ toolCallId: "mcp-1", toolName: "dse_list", args: {} }, {});
  calls.tool_execution_end({ toolCallId: "mcp-1" }, {});
  assert.equal(runResult(renderResult, makeResult("a", { mode: "call", server: "dse", tool: "list" }), { isPartial: false, expanded: false }, first), "Called dse");
  calls.tool_execution_start({ toolCallId: "mcp-2", toolName: "dse_get", args: {} }, {});
  calls.tool_execution_end({ toolCallId: "mcp-2" }, {});
  const merged = runResult(renderResult, makeResult("b", { mode: "call", server: "dse", tool: "get" }), { isPartial: false, expanded: false }, second);
  assert.equal(merged, "Called dse 2 times");
  const hidden = renderResult(makeResult("a", { mode: "call", server: "dse", tool: "list" }), { isPartial: false, expanded: false }, plainTheme, first).render(200);
  assert.deepEqual(hidden, []);
  const own = runResult(renderResult, makeResult("a", { mode: "call", server: "dse", tool: "list" }), { isPartial: false, expanded: true }, first);
  assert.match(own, /^● /);
  console.log("PASS: grouped MCP calls ->", JSON.stringify(merged), "(first row hidden, ctrl+o restores it)");
}

{
  const { maybeStartUiSession } = await jiti.import(path.join(agentDir, "npm/node_modules/pi-mcp-adapter/ui-session.ts"));
  const notices = [];
  const printed = [];
  const originalLog = console.log;
  console.log = (...args) => printed.push(args.join(" "));
  process.env.MCP_UI_VIEWER = "none";
  try {
    const session = await maybeStartUiSession(
      { ui: { notify: (text) => notices.push(text) }, manager: {} },
      { serverName: "atlassian", toolName: "getJiraIssue", toolArgs: {}, uiResourceUri: "ui://jira/issue" },
    );
    assert.equal(session, null);
  } finally {
    console.log = originalLog;
    delete process.env.MCP_UI_VIEWER;
  }
  assert.deepEqual(notices, []);
  assert.deepEqual(printed, []);
  console.log("PASS: MCP_UI_VIEWER=none -> no UI session, no notice, no [MCP-UI] line");
}

console.log("\nAll selftest assertions passed.");
