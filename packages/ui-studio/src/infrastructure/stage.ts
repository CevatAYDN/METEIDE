import type { Primitive } from "../domain/paint.js";

// The Studio's stage (ADR-052): PixiJS draws the room's primitives on a canvas. PixiJS loads here,
// lazily, so the fold and its Node tests never load it. No ticker runs: the stage renders once per
// draw or resize, so a hidden or idle panel costs nothing. shortcut: the tab 13 animations and
// their frame rates come with tween.js and the ticker.

/** A canvas the room is drawn on. */
export type Stage = {
	readonly draw: (primitives: readonly Primitive[]) => void;
	readonly resize: (width: number, height: number) => void;
	readonly destroy: () => void;
};

type Pixi = typeof import("pixi.js");

const paint = (pixi: Pixi, primitives: readonly Primitive[], font: string) => {
	const shapes = new pixi.Graphics();
	const texts = [];
	for (const p of primitives) {
		if (p.kind === "rect") {
			shapes.roundRect(p.x, p.y, p.w, p.h, 10).fill(p.fill);
			if (p.stroke) shapes.stroke({ width: 1.5, color: p.stroke });
		} else if (p.kind === "circle") shapes.circle(p.x, p.y, p.r).fill(p.fill);
		else
			texts.push(
				new pixi.Text({
					text: p.text,
					x: p.x,
					y: p.y,
					style: { fill: p.fill, fontSize: p.size, fontFamily: font },
				}),
			);
	}
	return [shapes, ...texts];
};

/** Starts PixiJS on the canvas; the room's text takes the canvas's own font family. */
export const createStage = async (
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): Promise<Stage> => {
	const pixi = await import("pixi.js");
	const app = new pixi.Application();
	await app.init({ canvas, width, height, autoStart: false, antialias: true });
	const font = getComputedStyle(canvas).fontFamily;
	return {
		draw: (primitives) => {
			for (const old of app.stage.removeChildren()) old.destroy();
			app.stage.addChild(...paint(pixi, primitives, font));
			app.render();
		},
		resize: (w, h) => {
			app.renderer.resize(w, h);
			app.render();
		},
		destroy: () => app.destroy(),
	};
};
