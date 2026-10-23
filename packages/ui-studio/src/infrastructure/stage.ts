import type { Effect, EffectColour } from "../domain/effects.js";
import { type Motion, motionsOf } from "../domain/motion.js";
import type { Primitive } from "../domain/paint.js";

// The Studio's stage (ADR-052): PixiJS draws the room's primitives on a canvas, and tween.js plays
// the effects of live events over it. Both load here, lazily, so the fold and its Node tests never
// load them. The ticker runs only while effects play, at most 60 frames a second, and stops when
// the last one ends or the panel hides, so an idle or hidden room draws nothing (docs/13, Performance
// and access). Reduced motion plays no particles, moves or jumps; marks still show, without motion.
// shortcut: a moving note or character is a ghost travelling to where the room already draws it.

/** A canvas the room is drawn on and its effects are played over. */
export type Stage = {
	readonly draw: (primitives: readonly Primitive[]) => void;
	readonly resize: (width: number, height: number) => void;
	readonly play: (
		effects: readonly Effect[],
		colours: Record<EffectColour, string>,
	) => void;
	readonly pause: () => void;
	readonly resume: () => void;
	readonly destroy: () => void;
};

type Pixi = typeof import("pixi.js");
type Tweens = typeof import("@tweenjs/tween.js");

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

type Player = {
	readonly pixi: Pixi;
	readonly tw: Tweens;
	readonly group: InstanceType<Tweens["Group"]>;
	readonly fx: InstanceType<Pixi["Container"]>;
	readonly reduced: boolean;
	readonly font: string;
	particles: number;
	readonly start: () => void;
};

const shapeOf = (p: Player, m: Motion) => {
	const s = m.shape;
	const target =
		s.kind === "dot"
			? new p.pixi.Graphics().circle(0, 0, s.r).fill(s.colour)
			: new p.pixi.Text({
					text: s.text,
					style: {
						fill: s.colour,
						fontSize: 18,
						fontFamily: p.font,
						fontWeight: "700",
					},
				});
	if (s.kind === "dot") target.alpha = s.alpha;
	target.position.set(m.from.x, m.from.y);
	return target;
};

// Tweens the motion's shape to its end, then removes it from the effects layer.
const animate = (p: Player, m: Motion) => {
	const target = shapeOf(p, m);
	p.fx.addChild(target);
	if (m.particle) p.particles++;
	const tween = new p.tw.Tween(target, p.group)
		.to(m.to, m.ms)
		.easing(p.tw.Easing.Quadratic.Out)
		.onComplete(() => {
			p.group.remove(tween);
			target.destroy();
			if (m.particle) p.particles--;
		})
		.start();
	p.start();
};

type App = InstanceType<Pixi["Application"]>;

// The effects player of a stage: its tweens drive the ticker, which stops when none is left.
const playerOf = (
	pixi: Pixi,
	tw: Tweens,
	app: App,
	canvas: HTMLCanvasElement,
) => {
	const fx = new pixi.Container();
	const group = new tw.Group();
	const state = { paused: false };
	const player: Player = {
		pixi,
		tw,
		group,
		fx,
		particles: 0,
		reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
		font: getComputedStyle(canvas).fontFamily,
		start: () => {
			if (!state.paused) app.ticker.start();
		},
	};
	app.ticker.add(() => {
		group.update(performance.now());
		if (group.getAll().length === 0) app.ticker.stop();
	});
	const pause = () => {
		state.paused = true;
		app.ticker.stop();
	};
	const resume = () => {
		state.paused = false;
		if (group.getAll().length > 0) app.ticker.start();
	};
	return { player, pause, resume };
};

/** Starts PixiJS on the canvas; the room's text takes the canvas's own font family. */
export const createStage = async (
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): Promise<Stage> => {
	const [pixi, tw] = await Promise.all([
		import("pixi.js"),
		import("@tweenjs/tween.js"),
	]);
	const app = new pixi.Application();
	await app.init({ canvas, width, height, autoStart: false, antialias: true });
	app.ticker.maxFPS = 60;
	const room = new pixi.Container();
	const dim = new pixi.Graphics();
	const { player, pause, resume } = playerOf(pixi, tw, app, canvas);
	app.stage.addChild(room, dim, player.fx);
	return {
		draw: (primitives) => {
			for (const old of room.removeChildren()) old.destroy();
			room.addChild(...paint(pixi, primitives, player.font));
			app.render();
		},
		resize: (w, h) => {
			app.renderer.resize(w, h);
			app.render();
		},
		play: (effects, colours) => {
			const shade = effects.findLast((e) => e.kind === "dim");
			if (shade?.kind === "dim")
				dim
					.clear()
					.rect(0, 0, app.screen.width, app.screen.height)
					.fill({ color: "#000000", alpha: shade.on ? 0.3 : 0 });
			for (const m of motionsOf(
				effects,
				colours,
				player.reduced,
				player.particles,
			))
				animate(player, m);
			app.render();
		},
		pause,
		resume,
		destroy: () => app.destroy(),
	};
};
