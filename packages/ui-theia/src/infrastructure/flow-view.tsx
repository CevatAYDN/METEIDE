import "@xyflow/react/dist/style.css";
import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { type Edge, type Node, Position, ReactFlow } from "@xyflow/react";
import { type CSSProperties, useMemo } from "react";
import { type FlowNodeData, flowGraph } from "../application/flow-graph.js";

// The Flow view of the Team panel (docs/13; ADR-051): the run's tasks and agents as a graph in React
// Flow (docs/05), read only. The stylesheet import keeps this file frontend-only.
// shortcut: the graph is fitted when its node count changes (a remount); a moved node does not refit.
// shortcut: React Flow zooms out to 0.5 at most, so a chain of more than about 10 levels is clipped;
// a zoom control or a smaller minimum is a decision for docs/13.

type TaskData = Extract<FlowNodeData, { kind: "task" }>;

// The METE tokens of the panel root, with Theia's colours in a high-contrast theme (ADR-069).
const BORDER: Record<TaskData["column"], string> = {
	todo: "var(--muted, var(--theia-descriptionForeground))",
	in_progress: "var(--accent, var(--theia-focusBorder))",
	done: "var(--good, var(--theia-contrastBorder))",
};

const markerText = (data: TaskData) =>
	data.marker === "in_review"
		? nls.localize("mete/board/inReview", "In review")
		: data.marker === "changes_asked"
			? nls.localize("mete/board/changesAsked", "Changes asked")
			: data.marker === "blocked"
				? nls.localize("mete/board/blocked", "Blocked")
				: "";

// An agent's border is dashed, and lit while it thinks.
const borderOf = (data: FlowNodeData) =>
	data.kind === "task"
		? `2px solid ${BORDER[data.column]}`
		: `2px dashed ${data.thinking ? BORDER.in_progress : BORDER.todo}`;

const labelOf = (data: FlowNodeData) =>
	data.kind === "task" ? (
		<>
			<div>{data.title}</div>
			<div style={{ opacity: 0.7 }}>
				{data.roleId}
				{data.marker ? ` · ${markerText(data)}` : ""}
			</div>
		</>
	) : (
		<>
			<div>{data.roleId}</div>
			<div style={{ opacity: 0.7 }}>
				{data.modelId}
				{data.progress ? ` · ${data.progress}` : ""}
			</div>
		</>
	);

const nodeStyle = (data: FlowNodeData): CSSProperties => ({
	border: borderOf(data),
	background: "var(--panel, var(--theia-editor-background))",
	color: "var(--ink, var(--theia-foreground))",
	borderRadius: "10px",
	width: 200,
});

const FRAME: CSSProperties = { height: "100%", minHeight: "360px" };

/** The run's tasks as a graph: a node per task and agent, an edge per dependsOn and per agent's task. */
export const FlowView = ({ view }: { readonly view: TeamView }) => {
	const { nodes, edges } = useMemo(() => {
		const g = flowGraph(view);
		return {
			nodes: g.nodes.map(
				(n): Node => ({
					id: n.id,
					position: { ...n.position },
					// Levels run left to right, so edges leave a node on its right and enter on its left;
					// an agent stands under its task, so its edge leaves from its top.
					sourcePosition:
						n.data.kind === "agent" ? Position.Top : Position.Right,
					targetPosition: Position.Left,
					data: { label: labelOf(n.data) },
					style: nodeStyle(n.data),
				}),
			),
			edges: g.edges.map((e): Edge => ({ ...e })),
		};
	}, [view]);
	return (
		<div style={FRAME}>
			<ReactFlow
				key={nodes.length}
				nodes={nodes}
				edges={edges}
				nodesDraggable={false}
				nodesConnectable={false}
				fitView
				// The canvas follows the panel's tokens, or Theia's theme in high contrast.
				style={{ background: "var(--bg, var(--theia-editor-background))" }}
			/>
		</div>
	);
};
