// Public API of this package: the run view model the Team panel's views share (ADR-051).
export { type AgentCard, agentsAfter } from "./domain/agents.js";
export {
	type Effect,
	type EffectColour,
	effectsOf,
	type Frame,
} from "./domain/effects.js";
export {
	type Box,
	type Layout,
	layoutOf,
	type Point,
} from "./domain/layout.js";
export {
	effectColours,
	type Primitive,
	paintScene,
	type StageLabels,
} from "./domain/paint.js";
export {
	type Character,
	type CharacterState,
	type Scene,
	sceneOf,
} from "./domain/scene.js";
export { NO_SIGNALS, type RunSignals, signalsAfter } from "./domain/signals.js";
export {
	applyAll,
	applyEvent,
	EMPTY_TEAM_VIEW,
	type Place,
	placeOf,
	type TaskCard,
	type TaskStatus,
	type TeamView,
} from "./domain/team-view.js";
export { createStage, type Stage } from "./infrastructure/stage.js";
