import { z } from "zod";

/** A core budget slot, separate from the gateway's provider-quota accounting (ADR-174). */
export const RequestReservationSchema = z.strictObject({
	id: z.string().min(1),
	task: z.string().min(1),
	agentId: z.string().min(1),
});

export type RequestReservation = z.output<typeof RequestReservationSchema>;
