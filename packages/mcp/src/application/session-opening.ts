import type { OpenTransport } from "../infrastructure/transport.js";
import {
	type PreparedSessionCredentials,
	pendingSessionConnection,
} from "./session-credentials.js";

type SessionResult = Awaited<ReturnType<typeof pendingSessionConnection>>;

/** Opens the prepared transport without changing its shared credential endpoints. */
export const openSessionTransport = (
	open: OpenTransport,
	cwd: string,
	prepared: PreparedSessionCredentials,
) =>
	open(prepared.server, {
		cwd,
		...(prepared.fetch ? { fetch: prepared.fetch } : {}),
		...(prepared.flow ? { auth: prepared.flow.provider } : {}),
		...(prepared.credentialEndpoints
			? { credentialEndpoints: prepared.credentialEndpoints }
			: {}),
	});

/** Retires only this opening's entry, so an old close cannot remove a newer one. */
export const openPendingSession = (
	live: Map<string, Promise<SessionResult>>,
	id: string,
	signal: AbortSignal,
	connect: (retire: () => void) => Promise<SessionResult>,
) => {
	const forget = () => {
		if (live.get(id) === opening) live.delete(id);
	};
	const opening = pendingSessionConnection(
		signal,
		() => connect(forget),
		forget,
	).then((r) => {
		if (!r.ok) forget();
		return r;
	});
	live.set(id, opening);
	return opening;
};
