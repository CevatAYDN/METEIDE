import type { RequestReservation } from "./reservation-schema.js";
import type { RunContext } from "./run-types.js";

export {
	type RequestReservation,
	RequestReservationSchema,
} from "./reservation-schema.js";

/** Completed replies and calls still in flight share the run's request limit. */
export const occupiedRequests = (context: RunContext) =>
	context.requests + (context.reservations?.length ?? 0);

/** Whether a result still owns the reservation and task attempt it started with. */
export const reservedFor = (context: RunContext, id: string, task: string) =>
	context.reservations?.some(
		(r) =>
			r.id === id &&
			r.task === task &&
			r.agentId === context.team?.tasks[task]?.context.agentId,
	) === true;

/** Only the currently assigned attempt may take a slot, once per task. */
export const canReserve = (
	context: RunContext,
	reservation: RequestReservation,
	limit: number,
) => {
	const entry = context.team?.tasks[reservation.task];
	return (
		occupiedRequests(context) < limit &&
		entry?.status === "in_progress" &&
		entry.context.agentId === reservation.agentId &&
		!context.reservations?.some(
			(r) => r.id === reservation.id || r.task === reservation.task,
		)
	);
};
