import type { ToolContext } from "@mete/contracts";

// A sampling request carries no link to the tool call that caused it, so the call in flight on
// each server is remembered; its run is the one whose budget the request spends.
// shortcut: concurrent calls on one server share the latest; upgrade when a server runs several at once.

export const createCalls = () => {
	const latest = new Map<string, ToolContext>();
	return {
		/** Runs `fn` while `ctx` is the call in flight on `server`. */
		during: async <T>(
			server: string,
			ctx: ToolContext,
			fn: () => Promise<T>,
		) => {
			latest.set(server, ctx);
			try {
				return await fn();
			} finally {
				if (latest.get(server) === ctx) latest.delete(server);
			}
		},
		current: (server: string) => latest.get(server),
	};
};

export type Calls = ReturnType<typeof createCalls>;
