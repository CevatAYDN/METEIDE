import {
	createStage,
	paintScene,
	type Stage,
	type StageLabels,
	sceneOf,
	type TeamView,
} from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { useEffect, useMemo, useRef, useState } from "react";

/** The token mode the room is painted in: light or dark. */
type TokenMode = Parameters<typeof paintScene>[1];

// The Studio view of the Team panel (docs/13; ADR-052): the room of @mete/ui-studio on a canvas.
// The canvas follows its box's width (Theia's panels resize without a window resize) and the
// room's height; it is drawn again when the run, the width or the theme mode changes.

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

/** The run's studio room, in the colours of the editor's theme mode. */
export const StudioView = ({
	view,
	mode,
}: {
	readonly view: TeamView;
	readonly mode: TokenMode;
}) => {
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const width = useWidth(box);
	const stage = useStage(canvas);
	const primitives = useMemo(
		() => (width > 0 ? paintScene(sceneOf(view), mode, width, labels()) : []),
		[view, mode, width],
	);
	useEffect(() => {
		const room = primitives[0];
		if (!stage || room?.kind !== "rect") return;
		stage.resize(width, room.h);
		stage.draw(primitives);
	}, [stage, primitives, width]);
	return (
		<div ref={box} style={{ width: "100%" }}>
			<canvas ref={canvas} style={{ display: "block", borderRadius: "20px" }} />
		</div>
	);
};
