import { type EventType, type MeteEvent, parseEvent } from "@mete/contracts";

// Event bus from docs/06-kernel-and-modules.md (Kernel API).

/** Releases what a call created; calling it twice is harmless. */
export type Disposable = { readonly dispose: () => void };

/** Receives the events of one type, or every event under a `prefix.*` pattern. */
export type Handler<T extends EventType> = (
	event: Extract<MeteEvent, { type: T }>,
) => void;

/** Called when a handler throws; the supervisor wires it in. */
export type HandlerErrorSink = (error: unknown, event: MeteEvent) => void;

/** In-process publish and subscribe for catalog events. */
export interface EventBus {
	publish<E extends MeteEvent>(event: E): void;
	subscribe<T extends MeteEvent["type"]>(
		type: T | `${string}.*`,
		handler: Handler<T>,
	): Disposable;
}

type Subscription = {
	readonly pattern: string;
	readonly handler: (event: MeteEvent) => void;
};

// "agent.*" matches agent.created and agent.tool.called, never agentx.created.
const matches = (pattern: string, type: string): boolean =>
	pattern.endsWith(".*")
		? type.startsWith(pattern.slice(0, -1))
		: pattern === type;

/** Creates a bus that isolates subscribers: one throwing handler never stops the others. */
export const createEventBus = (onHandlerError: HandlerErrorSink): EventBus => {
	const subscriptions = new Set<Subscription>();
	return {
		publish(event) {
			const parsed = parseEvent(event);
			// Typed in-process callers cannot normally get here, so it is a bug (ADR-034).
			if (!parsed.ok) throw new Error(parsed.error.issues.join("; "));
			// Snapshot: a handler may subscribe or dispose while this publish runs.
			for (const s of [...subscriptions]) {
				if (!subscriptions.has(s) || !matches(s.pattern, event.type)) continue;
				try {
					s.handler(event);
				} catch (error) {
					onHandlerError(error, event);
				}
			}
		},
		subscribe(type, handler) {
			const sub: Subscription = {
				pattern: type,
				handler: handler as (event: MeteEvent) => void,
			};
			subscriptions.add(sub);
			return { dispose: () => subscriptions.delete(sub) };
		},
	};
};
