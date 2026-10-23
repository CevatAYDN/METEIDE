import type { AgentCard, Character, TaskCard } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { MUTED } from "./look.js";

// The card a click on a Studio character opens (docs/13, Interaction): its role, its state, and for
// each agent it stands for the provider, the model and the task. The demo's card is the model
// (docs/prototypes/studio-view.html): 236 wide, above the head, or under it near the room's top. The
// tier comes with agent.created (ADR-077); an agent of an older run has none, and shows none.
// shortcut: docs/13's request count is left out: no event names the agent of a request
// (quota.consumed), as ADR-077 says; it needs a decision on such an event.

/** The card's tallest, in pixels: a group of many agents scrolls inside it. */
export const CARD_MAX_HEIGHT = 280;

/** Where the card points: the head in the panel's pixels, and whether it opens under the head. */
export type CardPlace = {
	readonly x: number;
	readonly y: number;
	readonly under: boolean;
};

type Props = {
	readonly character: Character;
	readonly agents: readonly AgentCard[];
	readonly tasks: readonly TaskCard[];
	readonly place: CardPlace;
	readonly onClose: () => void;
};

const until = (at: string) =>
	new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The character's state in words, as the room draws it. */
export const stateText = (c: Character): string => {
	if (c.state === "thinking")
		return nls.localize("mete/studio/cardThinking", "Thinking");
	if (c.state === "working")
		return c.tool
			? nls.localize("mete/studio/cardWorkingWith", "Working with {0}", c.tool)
			: nls.localize("mete/studio/cardWorking", "Working");
	if (c.state === "waiting")
		return c.resetsAt
			? nls.localize(
					"mete/studio/cardWaitingUntil",
					"Waiting for quota until {0}",
					until(c.resetsAt),
				)
			: nls.localize("mete/studio/cardWaiting", "Waiting for quota");
	return nls.localize("mete/studio/cardIdle", "Idle");
};

const Row = (props: { readonly term: string; readonly value: string }) => (
	<>
		<dt style={MUTED}>{props.term}</dt>
		<dd style={{ margin: 0 }}>{props.value}</dd>
	</>
);

const AgentRows = ({
	agent,
	tasks,
}: {
	readonly agent: AgentCard;
	readonly tasks: readonly TaskCard[];
}) => (
	<>
		{agent.tier ? (
			<Row
				term={nls.localize("mete/studio/cardTier", "Tier")}
				value={agent.tier}
			/>
		) : null}
		<Row
			term={nls.localize("mete/studio/cardProvider", "Provider")}
			value={agent.providerId}
		/>
		<Row
			term={nls.localize("mete/studio/cardModel", "Model")}
			value={agent.modelId}
		/>
		<Row
			term={nls.localize("mete/studio/cardTask", "Task")}
			value={
				tasks.find((t) => t.id === agent.taskId)?.title ??
				nls.localize("mete/studio/cardNoTask", "None")
			}
		/>
	</>
);

/** The card of one character, placed over the room; Escape and a click elsewhere close it. */
export const StudioCard = ({
	character,
	agents,
	tasks,
	place,
	onClose,
}: Props) => (
	<div
		role="dialog"
		aria-label={character.roleId}
		className="mete-card"
		style={{
			position: "absolute",
			left: place.x,
			top: place.y,
			width: "236px",
			maxHeight: `${CARD_MAX_HEIGHT}px`,
			overflowY: "auto",
			boxSizing: "border-box",
			transform: place.under
				? "translate(-50%, 16px)"
				: "translate(-50%, calc(-100% - 12px))",
			zIndex: 2,
		}}
	>
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			<b style={{ fontSize: "1.1em", flex: 1 }}>
				{character.roleId}
				{character.count > 1 ? ` ×${character.count}` : ""}
			</b>
			<button
				type="button"
				className="mete-button quiet"
				aria-label={nls.localize("mete/studio/cardClose", "Close")}
				onClick={onClose}
			>
				×
			</button>
		</div>
		<dl
			style={{
				display: "grid",
				gridTemplateColumns: "auto 1fr",
				gap: "1px 10px",
				margin: "6px 0 0",
			}}
		>
			<Row
				term={nls.localize("mete/studio/cardStatus", "Status")}
				value={stateText(character)}
			/>
			{agents.map((a) => (
				<AgentRows key={a.id} agent={a} tasks={tasks} />
			))}
		</dl>
	</div>
);
