import type { MeteEvent } from "@mete/contracts";
import {
	type Character,
	characterAt,
	createStage,
	EFFECT_COLOURS,
	effectsOf,
	inside,
	layoutOf,
	nameOf,
	paintScene,
	ROOM_W,
	type Scene,
	type Stage,
	type StageLabels,
	sceneOf,
	type TeamView,
} from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { useEffect, useMemo, useRef, useState } from "react";
import { MUTED, ROW } from "../application/look.js";
import {
	CARD_MAX_HEIGHT,
	type CardPlace,
	StudioCard,
} from "../application/studio-card.js";
import { attemptName } from "../application/studio-text.js";

// The Studio view of the Team panel (docs/13; ADR-052, ADR-070): the room of @mete/ui-studio on a
// canvas, in the demo's own colours. The canvas follows its box's width (Theia's panels resize
// without a window resize), the stage scaling the room to it; it is drawn again when the run or the
// width changes.

const labels = (): StageLabels => ({
	todo: nls.localize("mete/board/todo", "To do"),
	inProgress: nls.localize("mete/board/inProgress", "In progress"),
	done: nls.localize("mete/board/done", "Done"),
	coffee: nls.localize("mete/studio/coffee", "Coffee corner"),
	vault: nls.localize("mete/studio/vault", "Vault"),
	until: (resetsAt) =>
		nls.localize(
			"mete/studio/until",
			"until {0}",
			new Date(resetsAt).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			}),
		),
	attempt: attemptName,
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

// The open character card: a click on a character or its button opens it, and Escape, a click
// outside the Studio, a click elsewhere in the room or the same button closes it.
const useCard = (box: React.RefObject<HTMLDivElement | null>) => {
	const [selected, setSelected] = useState<string>();
	const [opened, setOpened] = useState(false);
	useEffect(() => {
		if (!selected) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelected(undefined);
		};
		const onDown = (e: MouseEvent) => {
			if (!(e.target instanceof Node && box.current?.contains(e.target)))
				setSelected(undefined);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onDown);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onDown);
		};
	}, [selected, box]);
	const show = (id: string | undefined) => {
		setSelected(id);
		if (id) setOpened(true);
	};
	const toggle = (id: string) => show(selected === id ? undefined : id);
	return { selected, opened, show, toggle };
};

// The card over the head, in the panel's pixels, kept inside the room as the demo keeps it; it opens
// under the head when its full height would not fit above.
const placeOf = (head: { x: number; y: number }, width: number): CardPlace => {
	const k = width / ROOM_W;
	const under = (head.y - 30) * k < CARD_MAX_HEIGHT + 12;
	return {
		x: Math.min(Math.max(head.x, 130), ROOM_W - 130) * k,
		y: (under ? head.y + 30 : head.y - 30) * k,
		under,
	};
};

const charactersOf = (scene: Scene): Character[] => scene.rows.flat();

// One button per character under the room, the keyboard's way to its card, and a hint until one opens.
const TeamStrip = (props: {
	readonly characters: readonly Character[];
	readonly selected: string | undefined;
	readonly hint: boolean;
	readonly onToggle: (id: string) => void;
}) => (
	<div style={{ ...ROW, marginTop: "8px" }}>
		{props.characters.map((c) => (
			<button
				key={c.id}
				type="button"
				className="mete-button quiet"
				aria-pressed={props.selected === c.id}
				onClick={() => props.onToggle(c.id)}
			>
				{c.count > 1
					? `${c.roleId} ×${c.count}`
					: nameOf(c, { attempt: attemptName })}
			</button>
		))}
		{props.hint && props.characters.length > 0 ? (
			<span style={MUTED}>
				{nls.localize(
					"mete/studio/cardHint",
					"Click a character or its name to see what it is doing",
				)}
			</span>
		) : null}
	</div>
);

// The still room is drawn once per change; its moving part (the window, the clock, eyes) is drawn by
// the stage every frame, from the user's clock.
const useRoom = (stage: Stage | undefined, scene: Scene, width: number) => {
	const painted = useMemo(
		() => (width > 0 ? paintScene(scene, labels()) : undefined),
		[scene, width],
	);
	useEffect(() => {
		const room = painted?.still[0];
		if (!stage || !painted || room?.kind !== "rect") return;
		stage.resize(width, room.h);
		stage.draw(painted);
	}, [stage, painted, width]);
};

// The agents a character stands for: itself, or every agent of its role when it is a group.
const agentsOf = (view: TeamView, c: Character) =>
	view.agents.filter(
		(a) => a.id === c.id || (c.count > 1 && a.roleId === c.id),
	);

// A click's offset, scaled back to the room's own space, is a point of the layout; a character wins
// over the coffee corner, where a waiting one stands.
// shortcut: notes and the bookshelf take no click yet (no task view, no vault view).
const hitOf =
	(layout: ReturnType<typeof layoutOf>, width: number) =>
	(e: React.MouseEvent) => {
		const k = ROOM_W / width;
		const p = { x: e.nativeEvent.offsetX * k, y: e.nativeEvent.offsetY * k };
		const id = characterAt(layout, p);
		return { id, coffee: !id && inside(layout.coffee, p) };
	};

// The card of the selected character, while it is in the room.
const OpenCard = (props: {
	readonly view: TeamView;
	readonly scene: Scene;
	readonly layout: ReturnType<typeof layoutOf>;
	readonly selected: string | undefined;
	readonly width: number;
	readonly onClose: () => void;
}) => {
	const open = charactersOf(props.scene).find((c) => c.id === props.selected);
	const head = open && props.layout.heads[open.id];
	return open && head ? (
		<StudioCard
			character={open}
			agents={agentsOf(props.view, open)}
			tasks={props.view.tasks}
			place={placeOf(head, props.width)}
			onClose={props.onClose}
		/>
	) : null;
};

/** The run's studio room, with its live effects and its characters' cards. */
export const StudioView = (props: Props) => {
	const { view } = props;
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const width = useWidth(box);
	const stage = useStage(canvas);
	const scene = useMemo(() => sceneOf(view), [view]);
	const layout = useMemo(() => layoutOf(scene), [scene]);
	useRoom(stage, scene, width);
	useEffects(stage, props, width);
	const card = useCard(box);
	const hit = hitOf(layout, width);
	return (
		<div ref={box} style={{ width: "100%" }}>
			<div style={{ position: "relative" }}>
				<canvas
					ref={canvas}
					className="mete-stage"
					style={{ display: "block" }}
					onClick={(e) => {
						const h = hit(e);
						card.show(h.id);
						if (h.coffee) props.onCoffee?.();
					}}
					onMouseMove={(e) => {
						const h = hit(e);
						e.currentTarget.style.cursor =
							h.id || (props.onCoffee && h.coffee) ? "pointer" : "";
					}}
				/>
				<OpenCard
					view={view}
					scene={scene}
					layout={layout}
					selected={card.selected}
					width={width}
					onClose={() => card.show(undefined)}
				/>
			</div>
			<TeamStrip
				characters={charactersOf(scene)}
				selected={card.selected}
				hint={!card.opened}
				onToggle={card.toggle}
			/>
		</div>
	);
};
