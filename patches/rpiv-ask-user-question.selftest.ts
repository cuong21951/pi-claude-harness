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
  },
});

const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi/agent");
const mod = await jiti.import(path.join(agentDir, "npm/node_modules/@juicesharp/rpiv-ask-user-question/ask-user-question.ts"));
const { answeredRows, registerAskUserQuestionTool } = mod;

const tagged = { fg: (role, text) => `<${role}>${text}</${role}>` };
const plain = { fg: (_role, text) => text };
const render = (component) => component.render(200).map((line) => line.trimEnd()).join("\n");

let tool;
registerAskUserQuestionTool({ registerTool: (definition) => (tool = definition), on: () => {} });
assert.ok(tool, "tool registered");
assert.equal(tool.renderShell, "self");
assert.equal(render(tool.renderCall({}, plain, {})), "");
assert.equal(render(tool.renderResult({ content: [], details: {} }, { expanded: false, isPartial: true }, plain, {})), "");
console.log("PASS: nothing drawn while the questionnaire is open");

{
  const details = { answers: [{ questionIndex: 0, question: "Pick one", kind: "option", answer: "Alpha" }], cancelled: false };
  const rows = answeredRows(details, tagged);
  assert.deepEqual(rows, ["<muted>● </muted><toolTitle>User answered Claude's questions:</toolTitle>", "<muted>  ⎿  · Pick one → Alpha</muted>"]);
  console.log("PASS: one answer ->", JSON.stringify(rows));
}
{
  const details = {
    answers: [
      { questionIndex: 0, question: "Sheet?", kind: "custom", answer: "https://x" },
      { questionIndex: 1, question: "Trigger?", kind: "multi", selected: ["Scheduled", "Manual"] },
    ],
    cancelled: false,
  };
  const rows = render(tool.renderResult({ content: [], details }, { expanded: false, isPartial: false }, plain, {}));
  assert.equal(rows, "● User answered Claude's questions:\n  ⎿  · Sheet? → https://x\n     · Trigger? → Scheduled, Manual");
  console.log("PASS: several answers ->", JSON.stringify(rows));
}
{
  const rows = answeredRows({ answers: [], cancelled: true }, plain);
  assert.deepEqual(rows, ["● User declined to answer questions"]);
  assert.deepEqual(answeredRows(undefined, plain), ["● User declined to answer questions"]);
  console.log("PASS: declined ->", JSON.stringify(rows));
}
console.log("ok - rpiv-ask-user-question rows");
