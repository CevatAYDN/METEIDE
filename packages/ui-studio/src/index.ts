// Public API of this package: the run view model the Team panel's views share (ADR-051).
export { type AgentCard, agentsAfter } from "./domain/agents.js";
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
