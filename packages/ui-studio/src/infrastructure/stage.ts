import type { TextStyleFontWeight } from "pixi.js";
import { ROOM_W } from "../defaults.js";
import type { Effect, EffectColour } from "../domain/effects.js";
import { type Motion, motionsOf } from "../domain/motion.js";
import type { Painted, Primitive, Shape } from "../domain/primitive.js";

// The Studio's stage (ADR-052, ADR-070): PixiJS draws the room's primitives on a canvas, scaled
// from the room's own space to the panel's width, and tween.js plays the effects of live events
// over it. Both load here, lazily, so the fold and its Node tests never load them. The still part of
// the room is drawn once per change; its moving part (the window, the clock, leaves, eyes, dots) is
// one Graphics cleared and drawn again every frame. The ticker runs while the panel shows, at 30
// frames a second, and at 60 while effects play; a hidden panel draws nothing (docs/13, Performance
// and access). Reduced motion draws the moving part once and plays no idle animation, no particles,
// moves or jumps; marks still show, without motion.
// shortcut: a moving note or character is a ghost travelling to where the room already draws it.

/** A canvas the room is drawn on and its effects are played over. */
export type Stage = {
	readonly draw: (painted: Painted) => void;
	/** The canvas's width in pixels and the room's height in the room's own space. */
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

type Shapes = InstanceType<Pixi["Graphics"]>;
type Words = Extract<Primitive, { kind: "text" | "label" }>;

const shape = (g: Shapes, p: Shape) => {
	if (p.kind === "rect")
		(p.r
			? g.roundRect(p.x, p.y, p.w, p.h, p.r)
			: g.rect(p.x, p.y, p.w, p.h)
		).fill(p.fill);
	else if (p.kind === "circle") g.circle(p.x, p.y, p.r).fill(p.fill);
	else if (p.kind === "ellipse") g.ellipse(p.x, p.y, p.rx, p.ry).fill(p.fill);
	else if (p.kind === "poly") g.poly([...p.points]).fill(p.fill);
	else if (p.kind === "line")
		g.moveTo(p.x1, p.y1)
			.lineTo(p.x2, p.y2)
			.stroke({ width: p.width, color: p.stroke, cap: "round" });
	// moveTo the arc's start, so no line joins it to the shape before it.
	else
		g.moveTo(p.x + Math.cos(p.start) * p.r, p.y + Math.sin(p.start) * p.r)
			.arc(p.x, p.y, p.r, p.start, p.end)
			.stroke({ width: p.width, color: p.stroke, cap: "round" });
};

// The text cut with "…" until it fits its width.
const fitted = (
	pixi: Pixi,
	p: Words,
	style: InstanceType<Pixi["TextStyle"]>,
) => {
	const max = p.maxWidth;
	const width = (t: string) =>
		pixi.CanvasTextMetrics.measureText(t, style).width;
	if (max === undefined || width(p.text) <= max) return p.text;
	let t = p.text;
	while (t.length > 1 && width(`${t}…`) > max) t = t.slice(0, -1);
	return `${t}…`;
};

// A text, or a label's text with its pill drawn on `g` under it.
const words = (pixi: Pixi, g: Shapes, p: Words, font: string) => {
	const style = new pixi.TextStyle({
		fill: p.kind === "label" ? p.ink : p.fill,
		fontSize: p.size,
		fontFamily: font,
		fontWeight: String(
			p.kind === "text" ? (p.weight ?? 600) : 700,
		) as TextStyleFontWeight,
	});
	const text = new pixi.Text({ text: fitted(pixi, p, style), style });
	if (p.kind === "text") {
		text.position.set(p.x, p.y);
		return text;
	}
	const w = text.width + 14;
	const h = p.size + 6;
	g.roundRect(p.x - w / 2, p.y, w, h, h / 2).fill(p.fill);
	text.anchor.set(0.5);
	text.position.set(p.x, p.y + h / 2);
	return text;
};

// The primitives in their order: a text starts a new Graphics, so later shapes cover it.
const paint = (pixi: Pixi, primitives: readonly Primitive[], font: string) => {
	let g = new pixi.Graphics();
	const out: InstanceType<Pixi["Container"]>[] = [g];
	for (const p of primitives) {
		if (p.kind !== "text" && p.kind !== "label") {
			shape(g, p);
			continue;
		}
		out.push(words(pixi, g, p, font));
		g = new pixi.Graphics();
		out.push(g);
	}
	return out;
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

// A bell: its dome and mouth, the rim, and the clapper under it.
const bell = (p: Player, colour: string) =>
	new p.pixi.Graphics()
		.roundRect(-6, -8, 12, 11, 6)
		.fill(colour)
		.roundRect(-8, 2, 16, 3, 1.5)
		.fill(colour)
		.circle(0, 7, 2)
		.fill(colour);

const shapeOf = (p: Player, m: Motion) => {
	const s = m.shape;
	const target =
		s.kind === "dot"
			? new p.pixi.Graphics().circle(0, 0, s.r).fill(s.colour)
			: s.kind === "icon"
				? bell(p, s.colour)
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

// A throw inside a Pixi tick ends the ticker for good, so a failing frame is reported once, apart from
// the tick, and the next frame tries again.
const guarded = (draw: () => void) => {
	let failed = false;
	return () => {
		try {
			draw();
		} catch (e) {
			if (failed) return;
			failed = true;
			queueMicrotask(() => {
				throw e;
			});
		}
	};
};

// The effects player of a stage and its ticker: each frame the tweens advance and the moving part of
// the room is drawn again, at 30 frames a second, 60 while a tween plays. With reduced motion the
// ticker runs only while tweens do.
const playerOf = (
	pixi: Pixi,
	tw: Tweens,
	app: App,
	live: { readonly canvas: HTMLCanvasElement; readonly draw: () => void },
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
		font: getComputedStyle(live.canvas).fontFamily,
		start: () => {
			if (!state.paused) app.ticker.start();
		},
	};
	const drawLive = guarded(live.draw);
	app.ticker.add(() => {
		group.update(performance.now());
		const animating = group.getAll().length > 0;
		if (!player.reduced) {
			drawLive();
			app.ticker.maxFPS = animating ? 60 : 30;
		} else if (!animating) app.ticker.stop();
	});
	const pause = () => {
		state.paused = true;
		app.ticker.stop();
	};
	// The idle ticker runs whenever the panel shows, unless motion is reduced.
	const run = () => {
		if (!state.paused && !player.reduced) app.ticker.start();
	};
	const resume = () => {
		state.paused = false;
		if (!player.reduced || group.getAll().length > 0) app.ticker.start();
		else {
			drawLive();
			app.render();
		}
	};
	return { player, pause, resume, run };
};

const appOn = async (
	pixi: Pixi,
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): Promise<App> => {
	const app = new pixi.Application();
	await app.init({
		canvas,
		width,
		height,
		autoStart: false,
		antialias: true,
		// Crisp text and shapes on a high-density screen; the canvas keeps its CSS size.
		resolution: devicePixelRatio,
		autoDensity: true,
	});
	app.ticker.maxFPS = 60;
	return app;
};

// Plays the effects of live events over the room, a tween each.
const playOn =
	(app: App, player: Player): Stage["play"] =>
	(effects, colours) => {
		for (const m of motionsOf(
			effects,
			colours,
			player.reduced,
			player.particles,
		))
			animate(player, m);
		app.render();
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
	const app = await appOn(pixi, canvas, width, height);
	const room = new pixi.Container();
	const moving = new pixi.Graphics();
	let motion: Painted["moving"] = () => [];
	// The moving shapes of this moment, drawn again over the still room.
	const drawMoving = () => {
		moving.clear();
		for (const p of motion({ now: new Date(), t: performance.now() / 1000 }))
			shape(moving, p);
	};
	const { player, pause, resume, run } = playerOf(pixi, tw, app, {
		canvas,
		draw: drawMoving,
	});
	app.stage.addChild(room, moving, player.fx);
	return {
		draw: (painted) => {
			for (const old of room.removeChildren()) old.destroy();
			room.addChild(...paint(pixi, painted.still, player.font));
			motion = painted.moving;
			drawMoving();
			run();
			app.render();
		},
		// `h` is the room's height in its own space; the canvas takes the width's scale.
		resize: (w, h) => {
			const scale = w / ROOM_W;
			room.scale.set(scale);
			moving.scale.set(scale);
			player.fx.scale.set(scale);
			app.renderer.resize(w, Math.ceil(h * scale));
			app.render();
		},
		play: playOn(app, player),
		pause,
		resume,
		destroy: () => app.destroy(),
	};
};
