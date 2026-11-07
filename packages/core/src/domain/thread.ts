import type { ThreadStarted } from "@mete/contracts";

/** Parsed new-port intent; only the authored message enters the search index (ADR-182). */
export type ThreadIntent = {
	readonly requestId: string;
	readonly digest: string;
	readonly message: string;
	readonly conversationId?: string;
	readonly expectedRunId?: string;
};

/** A durable result distinguishes receipt replay from a newly committed run. */
export type ThreadSaved = ThreadStarted & { readonly fresh: boolean };
