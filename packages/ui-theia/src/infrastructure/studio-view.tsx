import type { MeteEvent } from "@mete/contracts";
import {
	createStage,
	EFFECT_COLOURS,
	effectsOf,
	inside,
	layoutOf,
	paintScene,
	ROOM_W,
	type Stage,
	type StageLabels,
	sceneOf,
	type TeamView,
} from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { useEffect, useMemo, useRef, useState } from "react";

// The Studio view of the Team panel (docs/13; ADR-052, ADR-070): the room of @mete/ui-studio on a
// canvas, in the demo's own colours. The canvas follows its box's width (Theia's panels resize
// without a window resize), the stage scaling the room to it; it is drawn again when the run or the
// width changes.

const labels = (): StageLabels => ({
	todo: nls.localize("mete/board/todo", "To do"),
	inProgress: nls.localize("mete/board/inProgress", "In progress"),
	done: nls.localize("mete/board/done", "Done"),
	coffee: nls.localize("mete/studio/coffee", "Coffee corner"),
	until: (resetsAt) =>
		nls.localize(
			"mete/studio/until",
			"until {0}",
			new Date(resetsAt).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			}),
		),
});

// The box's width, kept up to date while the panel resizes.
const useWidth = (box: React.RefObject<HTMLDivElement | null>) => {
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setWidth(el.clientWidth));
		observer.observe(el);
		setWidth(el.clientWidth);
		return () => observer.disconnect();
	}, [box]);
	return width;
};

// The stage on the canvas, made once; a stage that resolves after unmount is destroyed at once.
const useStage = (canvas: React.RefObject<HTMLCanvasElement | null>) => {
	const [stage, setStage] = useState<Stage>();
	useEffect(() => {
		let live = true;
		let made: Stage | undefined;
		const el = canvas.current;
		if (el)
			void createStage(el, 1, 1).then((s) => {
				made = s;
				if (live) setStage(s);
				else s.destroy();
			});
		return () => {
			live = false;
			made?.destroy();
		};
	}, [canvas]);
	return stage;
};

type Pulse = { readonly event: MeteEvent; readonly before: TeamView };

// Plays the effects of each new live event over the room, once; a hidden panel pauses the stage.
const useEffects = (stage: Stage | undefined, props: Props, width: number) => {
	// The pulse present at mount is past: only one that arrives afterwards plays (live events only).
	const played = useRef<Pulse | undefined>(props.pulse);
	const { pulse, view, active } = props;
	useEffect(() => {
		if (!stage || !pulse || width === 0 || played.current === pulse) return;
		played.current = pulse;
		const frame = (v: TeamView) => {
			const scene = sceneOf(v);
			return { view: v, layout: layoutOf(scene) };
		};
		stage.play(
			effectsOf(pulse.event, frame(pulse.before), frame(view)),
			EFFECT_COLOURS,
		);
	}, [stage, pulse, view, width]);
	useEffect(() => {
		if (active) stage?.resume();
		else stage?.pause();
	}, [stage, active]);
};

type Props = {
	readonly view: TeamView;
	readonly pulse?: Pulse;
	/** False while the panel is hidden: the stage stops. */
	readonly active: boolean;
	/** A click on the coffee corner (docs/13, Interaction: it opens the quota dashboard). */
	readonly onCoffee?: () => void;
};

/** The run's studio room, with its live effects. */
export const StudioView = (props: Props) => {
	const { view } = props;
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const width = useWidth(box);
	const stage = useStage(canvas);
	const primitives = useMemo(
		() => (width > 0 ? paintScene(sceneOf(view), labels()) : []),
		[view, width],
	);
	useEffect(() => {
		const room = primitives[0];
		if (!stage || room?.kind !== "rect") return;
		stage.resize(width, room.h);
		stage.draw(primitives);
	}, [stage, primitives, width]);
	useEffects(stage, props, width);
	// A click's offset, scaled back to the room's own space, is a point of the layout.
	// shortcut: notes and characters take no click yet (no task view, and the character card needs
	// tier and request count the fold does not carry); the palette opens the dashboard by keyboard.
	const coffee = useMemo(() => layoutOf(sceneOf(view)).coffee, [view]);
	const onCoffee = (e: React.MouseEvent) => {
		const scale = ROOM_W / width;
		return inside(coffee, {
			x: e.nativeEvent.offsetX * scale,
			y: e.nativeEvent.offsetY * scale,
		});
	};
	return (
		<div ref={box} style={{ width: "100%" }}>
			<canvas
				ref={canvas}
				className="mete-stage"
				style={{ display: "block" }}
				onClick={(e) => {
					if (onCoffee(e)) props.onCoffee?.();
				}}
				onMouseMove={(e) => {
					e.currentTarget.style.cursor =
						props.onCoffee && onCoffee(e) ? "pointer" : "";
				}}
			/>
		</div>
	);
};
