/** A daemon readiness, protocol, lifecycle or explicit-command failure (ADR-046). */
export type DaemonFailure = {
	readonly code:
		| "not_ready"
		| "choose_template"
		| "stopped"
		| "blocked"
		| "refused"
		| "protocol"
		| "cli";
	readonly detail: string;
	/** With choose_template: the templates the router suggests for the goal (ADR-047). */
	readonly suggestions?: readonly string[];
};
