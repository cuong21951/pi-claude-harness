import { createBashTool, type BashToolDetails, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { callLine, resultLines } from "./render.ts";

// ponytail: map is only a fallback when the model omits `description`.
// Claude's real mechanism is a model-supplied `description` field per bash call.
const INTENT_MAP: Array<[RegExp, string]> = [
	[/^git status/, "Kiểm tra trạng thái git"],
	[/^git diff/, "Xem diff chưa commit"],
	[/^git add/, "Staging file cho commit"],
	[/^git commit/, "Commit thay đổi"],
	[/^git push/, "Push lên remote"],
	[/^git pull/, "Kéo thay đổi từ remote"],
	[/^git log/, "Xem lịch sử commit"],
	[/^git stash/, "Stash thay đổi"],
	[/^git (checkout|switch|restore)/, "Chuyển branch / khôi phục file"],
	[/^git branch/, "Quản lý branch"],
	[/^git merge/, "Merge branch"],
	[/^git (reset|revert)/, "Reset / revert git"],
	[/^git/, "Git"],
	[/^ls\b|^dir\b/, "Liệt kê file"],
	[/^find\s/, "Tìm file"],
	[/^(rg|grep)\b/, "Tìm kiếm trong code"],
	[/^cat\s/, "Đọc file"],
	[/^cd\s/, "Đổi thư mục"],
	[/^pwd\b/, "Hiện thư mục hiện tại"],
	[/^mkdir\s/, "Tạo thư mục"],
	[/^(rm|del)\s/, "Xoá file"],
	[/^mv\s/, "Di chuyển / đổi tên"],
	[/^cp\s/, "Sao chép file"],
	[/^dotnet restore|^nuget restore/, "Restore NuGet package"],
	[/^dotnet build|^msbuild\s|^cargo build/, "Build"],
	[/^dotnet test|^vstest|^cargo test/, "Chạy test"],
	[/^npm install|^yarn add|^pnpm add|^npm i\b/, "Cài package"],
	[/^npm run/, "Chạy npm script"],
	[/^cargo run/, "Chạy chương trình"],
	[/^pip install/, "Cài Python package"],
	[/^python\s|^py\s/, "Chạy Python script"],
	[/^node\s/, "Chạy Node script"],
	[/^curl\s|^wget\s/, "Gọi HTTP"],
	[/^docker\s/, "Docker"],
	[/^az\s/, "Azure CLI"],
	[/^dotnet\b/, "dotnet"],
	[/^cargo\b/, "Cargo"],
	[/^npm\b/, "npm"],
];

function firstSegment(cmd: string): string {
	const seg = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).find((s) => s.trim());
	return seg ? seg.trim() : cmd;
}

function describe(raw: string): string {
	const seg = firstSegment(raw).replace(/^rtk\s+/, "");
	const lower = seg.toLowerCase();
	for (const [re, label] of INTENT_MAP) {
		if (re.test(lower)) return label;
	}
	return seg.length > 40 ? `${seg.slice(0, 37)}...` : seg;
}

export default function (pi: ExtensionAPI) {
	const originalBash = createBashTool(process.cwd());
	const params = originalBash.parameters as Record<string, any>;

	pi.registerTool({
		name: "bash",
		label: "bash",
		description:
			originalBash.description +
			"\nWhen you call bash, also provide a short `description` field stating in plain language what the command does (e.g. \"Check git status\"). The transcript shows this as the label.",
		renderShell: "self",
		parameters: {
			...params,
			properties: {
				...(params.properties ?? {}),
				description: { type: "string", description: "Short human-readable label of what the command does." },
			},
		},

		async execute(toolCallId, params, signal, onUpdate) {
			return originalBash.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const intent = (args as any).description?.trim() || describe((args as any).command);
			return new Text(callLine(intent, theme), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("dim", "  └ ") + theme.fg("dim", "Running…"), 0, 0);

			const details = result.details as BashToolDetails | undefined;
			const content = result.content[0];
			const output = content?.type === "text" ? content.text : "";
			const exitMatch = output.match(/exit(?:ed with)? code:? (\d+)/);
			const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
			const [head, ...rest] = resultLines(output, exitCode, expanded, details?.truncation?.truncated === true);
			const painted = theme.fg(exitCode && exitCode !== 0 ? "error" : "dim", head);
			return new Text([painted, ...rest.map((line) => theme.fg("toolOutput", line))].join("\n"), 0, 0);
		},
	});
}
