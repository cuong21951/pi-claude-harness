import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ImageContent } from "@earendil-works/pi-coding-agent";

const CHIP = /\[Image #(\d+)\]/g;

export type Pending = Map<number, ImageContent>;

// ponytail: Claude Code pastes an image as a "[Image #N]" chip in the prompt and ships the bytes with
// the message. pi's own alt+v writes a temp file path instead. Windows-only clipboard read via
// PowerShell (pi's clipboard helpers are not importable from extensions); other platforms keep pi's
// built-in ctrl+v behaviour because this shortcut only claims alt+v.
const READ_CLIPBOARD = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("png:" + [Convert]::ToBase64String($ms.ToArray()))
} else {
  $t = Get-Clipboard -Raw
  if ($t) { Write-Output ("txt:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))) }
}`;

async function readClipboard(): Promise<{ kind: "png" | "txt"; base64: string } | null> {
	if (process.platform !== "win32") return null;
	const { stdout } = await promisify(execFile)("powershell", ["-NoProfile", "-STA", "-Command", READ_CLIPBOARD], { maxBuffer: 64 * 1024 * 1024 });
	const out = stdout.trim();
	const kind = out.slice(0, 3);
	if (kind !== "png" && kind !== "txt") return null;
	return { kind, base64: out.slice(4) };
}

export function attach(text: string, pending: Pending, existing: ImageContent[] = []): { text: string; images: ImageContent[] } {
	const images = [...existing];
	for (const match of text.matchAll(CHIP)) {
		const n = Number(match[1]);
		const image = pending.get(n);
		if (!image) continue;
		images.push(image);
		pending.delete(n);
	}
	return { text, images };
}

export default function (pi: ExtensionAPI) {
	const pending: Pending = new Map();
	let counter = 0;

	pi.on("session_start", () => {
		pending.clear();
		counter = 0;
	});

	pi.registerShortcut("alt+v", {
		description: "Paste clipboard image as [Image #N]",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			const clip = await readClipboard();
			if (!clip) return ctx.ui.notify("Clipboard has no image or text", "warning");
			if (clip.kind === "txt") return ctx.ui.setEditorText(ctx.ui.getEditorText() + Buffer.from(clip.base64, "base64").toString("utf8"));
			const n = ++counter;
			pending.set(n, { type: "image", data: clip.base64, mimeType: "image/png" });
			ctx.ui.setEditorText(`${ctx.ui.getEditorText()}[Image #${n}] `);
		},
	});

	pi.on("input", (event) => {
		if (pending.size === 0) return { action: "continue" };
		const { text, images } = attach(event.text, pending, event.images);
		return { action: "transform", text, images };
	});
}

if (process.env.CLAUDE_IMAGES_SELFTEST) {
	const check = (ok: boolean, msg: string) => {
		if (!ok) throw new Error(`FAIL: ${msg}`);
		console.log(`ok - ${msg}`);
	};
	const img = (data: string): ImageContent => ({ type: "image", data, mimeType: "image/png" });
	const pending: Pending = new Map([[1, img("one")], [2, img("two")], [3, img("three")]]);
	const r = attach("look at [Image #2] and [Image #1]", pending, [img("prior")]);
	check(r.text === "look at [Image #2] and [Image #1]", "chip text stays in the message");
	check(r.images.map((i) => i.data).join(",") === "prior,two,one", "images follow chip order after existing ones");
	check([...pending.keys()].join() === "3", "used chips are removed, unused stay pending");
	check(attach("[Image #9]", pending).images.length === 0, "unknown chip attaches nothing");
	check(attach("no chips", pending).images.length === 0 && pending.size === 1, "plain text leaves pending untouched");
}
