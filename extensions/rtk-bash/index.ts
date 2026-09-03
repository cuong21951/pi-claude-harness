import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		try {
			if (!isToolCallEventType("bash", event)) return;
			const command = event.input.command;
			if (command.startsWith("rtk ")) return;
			const result = await pi.exec("rtk", ["hook", "check", command], { timeout: 5000 });
			const rewritten = result.stdout.trim();
			if (result.code === 0 && rewritten && rewritten !== command) {
				event.input.command = rewritten;
			}
		} catch {}
	});
}
