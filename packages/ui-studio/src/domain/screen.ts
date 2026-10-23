import { SCREEN } from "./palette.js";
import { type Primitive, rect, type Shape } from "./primitive.js";

// What a monitor shows while its character works (docs/13, the `agent.tool.called` row): code lines for
// `fs.*`, a results page for `web.*`, a painting for `media.*`, test rows for verify gates and
// `gameengine.test@1`. A monitor of a character that does not work stays dark (desk() draws that).
// shortcut: the stamped review document and the planning bars need events no module publishes yet
// (a review) or a role kind (planning), so they are not drawn; any other tool shows code lines, since a
// working agent with a dark monitor would read as idle; and the pictures are still, as the demo draws
// them at the start of a tool call. The monitor shows nothing while an agent thinks, because a
// character carries its tool only while it works.

/** What a monitor can show. */
export type ScreenKind = "code" | "search" | "paint" | "test";

/** The picture for a tool's capability id such as `fs.read@1`. */
export const screenKindOf = (tool: string | undefined): ScreenKind => {
	if (tool?.startsWith("web.")) return "search";
	if (tool?.startsWith("media.")) return "paint";
	if (tool?.startsWith("verify") || tool?.startsWith("gameengine.test"))
		return "test";
	return "code";
};

/** A monitor's screen: 54 wide, 36 high, at its top-left corner. */
export type ScreenBox = { readonly x: number; readonly y: number };

const W = 54;
const H = 36;

const code = ({ x, y }: ScreenBox): Primitive[] => [
	rect([x, y, W, H], 0, SCREEN.codeBg),
	// The demo's pseudo-random line lengths and indents, from its own formula.
	...Array.from({ length: 7 }, (_, i) => {
		const rnd = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
		const indent = [0, 5, 10, 5][i % 4] ?? 0;
		const width = Math.min(W - 8 - indent, 8 + rnd * 30);
		return rect(
			[x + 4 + indent, y + 3 + i * 5, width, 2.4],
			0,
			SCREEN.codeLines[i % SCREEN.codeLines.length] ?? SCREEN.codeBg,
		);
	}),
];

const search = ({ x, y }: ScreenBox): Primitive[] => [
	rect([x, y, W, H], 0, SCREEN.pageBg),
	rect([x + 4, y + 3, W - 8, 6], 3, SCREEN.pageBar),
	{
		kind: "arc",
		x: x + 8,
		y: y + 6,
		r: 1.8,
		start: 0,
		end: Math.PI * 2,
		stroke: SCREEN.pageGlass,
		width: 1,
	},
	...[0, 1, 2].flatMap((i) => [
		rect([x + 4, y + 13 + i * 7.5, 26, 2], 0, SCREEN.pageLink),
		rect([x + 4, y + 16.5 + i * 7.5, 40, 1.6], 0, SCREEN.pageText),
	]),
];

const paint = ({ x, y }: ScreenBox): Primitive[] => [
	rect([x, y, W, H], 0, SCREEN.paintBg),
	{ kind: "circle", x: x + W / 2, y: y + H / 2, r: 11, fill: SCREEN.paintArt },
	{
		kind: "circle",
		x: x + W / 2 - 3,
		y: y + H / 2 - 3,
		r: 4.4,
		fill: SCREEN.paintShine,
	},
];

const test = ({ x, y }: ScreenBox): Primitive[] => [
	rect([x, y, W, H], 0, SCREEN.codeBg),
	...[0, 1, 2].flatMap((i) => [
		rect([x + 5, y + 6 + i * 10, 6, 6], 1.5, SCREEN.testPending),
		rect([x + 15, y + 8 + i * 10, 30 - i * 4, 2], 0, SCREEN.testText),
	]),
];

/** The offline icon (docs/13, `run.paused` with reason `network`): a struck-out signal on a dark screen. */
export const offlineScreen = ({ x, y }: ScreenBox): Primitive[] => {
	const cx = x + W / 2;
	const cy = y + H / 2 + 8;
	return [
		rect([x, y, W, H], 0, SCREEN.offlineBg),
		{ kind: "circle", x: cx, y: cy, r: 1.8, fill: SCREEN.offlineIcon },
		...[6, 11, 16].map(
			(r): Primitive => ({
				kind: "arc",
				x: cx,
				y: cy,
				r,
				start: (-3 * Math.PI) / 4,
				end: -Math.PI / 4,
				stroke: SCREEN.offlineIcon,
				width: 1.6,
			}),
		),
		{
			kind: "line",
			x1: cx - 12,
			y1: y + 6,
			x2: cx + 12,
			y2: y + H - 6,
			stroke: SCREEN.offlineSlash,
			width: 2,
		},
	];
};

/** The dot that drifts across a dark monitor at `t` seconds, as a screensaver; `seed` offsets each monitor's path. */
export const sleepDot = (box: ScreenBox, seed: number, t: number): Shape => ({
	kind: "circle",
	x: box.x + W / 2 + Math.sin(t * 0.8 + seed) * (W / 2 - 6),
	y: box.y + H / 2 + Math.cos(t * 1.1 + seed) * (H / 2 - 6),
	r: 2.2,
	fill: SCREEN.sleepDot,
});

const PICTURES: Record<ScreenKind, (box: ScreenBox) => Primitive[]> = {
	code,
	search,
	paint,
	test,
};

/** The picture a monitor shows for a tool, over a dark screen whose top-left corner is `box`. */
export const screenOf = (
	tool: string | undefined,
	box: ScreenBox,
): Primitive[] => PICTURES[screenKindOf(tool)](box);
