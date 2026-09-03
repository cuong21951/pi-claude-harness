import * as os from "node:os";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

type Paint = (role: string, text: string) => string;
type Bold = (text: string) => string;

const FRAMES = 6;
const FRAME_MS = 700;

// ponytail: the frame comes from the wall clock, not a timer. The cat advances on
// repaints driven by anything else (spinner ticks while working) and never
// schedules its own, so an idle screen stays still instead of flickering.
export const frameNow = (now = Date.now()): number => Math.floor(now / FRAME_MS) % FRAMES;

// ponytail: Claude's header is mascot + three lines; the mascot here is a cat that blinks,
// wags its tail and drops a heart.
export function catFrame(frame: number): string[] {
	const eyes = frame % FRAMES === 4 ? "-.-" : "o.o";
	const tail = ["~ ", " ~", "~ ", " ~", "~ ", " ~"][frame % FRAMES];
	const heart = frame % FRAMES === 2 ? "♥" : " ";
	return [` /\\_/\\ ${heart}`, `( ${eyes} ) `, ` > ^ < ${tail}`];
}

function homeRelative(dir: string): string {
	const home = os.homedir();
	return dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
}

export function composeHeader(
	model: string,
	provider: string,
	thinking: string,
	cwd: string,
	frame: number,
	fg: Paint,
	bold: Bold,
): string[] {
	const cat = catFrame(frame).map((line) => fg("warning", line));
	const effort = thinking && thinking !== "off" ? ` with ${thinking} effort` : "";
	const right = [
		`${bold("pi")} ${fg("muted", `v${VERSION}`)}`,
		fg("muted", `${model}${effort} · ${provider}`),
		fg("muted", homeRelative(cwd)),
	];
	return ["", ...cat.map((line, i) => ` ${line}   ${right[i]}`), ""];
}

// ponytail: in regular TUI mode the header lives in scrollback once the transcript is taller than
// the terminal; pi-tui answers any change above the viewport with a full clear+redraw (the flicker).
// So the cat only moves while everything still fits (viewportTop 0) and freezes on its last frame
// after that. The alt-screen TUI has no viewportTop and repaints differentially, so it always animates.
export function headerFits(viewportTop: number | undefined): boolean {
	return (viewportTop ?? 0) === 0;
}

let ticker: ReturnType<typeof setInterval> | undefined;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setHeader((tui, theme) => {
			let frame = frameNow();
			const fits = () => headerFits((tui as { previousViewportTop?: number }).previousViewportTop);
			clearInterval(ticker);
			ticker = setInterval(() => {
				if (fits() && frameNow() !== frame) tui.requestRender();
			}, FRAME_MS);
			ticker.unref?.();
			return {
				render: (width: number) => {
					if (fits()) frame = frameNow();
					return composeHeader(
						ctx.model?.name ?? ctx.model?.id ?? "no model",
						ctx.model?.provider ?? "",
						ctx.thinkingLevel ?? "off",
						ctx.cwd,
						frame,
						(role, text) => theme.fg(role as never, text),
						(text) => theme.bold(text),
					).map((line) => truncateToWidth(line, width));
				},
				invalidate() {},
			};
		});
	});
}

if (process.env.CLAUDE_HEADER_SELFTEST) {
	const plain: Paint = (_r, t) => t;
	const lines = composeHeader("GLM 5.3 Flash (multimodal)", "commandcode", "high", `${os.homedir()}/Documents/Kuha`, 0, plain, (t) => t);
	if (lines.length !== 5) throw new Error("FAIL: blank, three rows, blank");
	if (!lines[1].includes("pi v")) throw new Error("FAIL: title row");
	if (!lines[2].includes("with high effort · commandcode")) throw new Error("FAIL: model row");
	if (!lines[3].includes("~")) throw new Error("FAIL: cwd row is home-relative");
	if (catFrame(0)[2] === catFrame(1)[2]) throw new Error("FAIL: tail must wag");
	if (!catFrame(4)[1].includes("-.-")) throw new Error("FAIL: blink frame");
	if (frameNow(0) !== 0 || frameNow(699) !== 0 || frameNow(700) !== 1) throw new Error("FAIL: frame advances every 700 ms");
	if (frameNow(2800) !== 4 || frameNow(4200) !== 0) throw new Error("FAIL: frame wraps every 6 frames");
	if (!headerFits(0) || !headerFits(undefined)) throw new Error("FAIL: animate while everything fits or in alt-screen");
	if (headerFits(1)) throw new Error("FAIL: freeze once the header scrolled into scrollback");
	console.log(lines.join("\n"));
	console.log("ok - claude layout with a cat");
}
