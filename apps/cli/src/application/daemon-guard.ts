import type { SecretsMaskAdapter } from "@mete/contracts";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";

// vscode-jsonrpc echoes a thrown Error's message to the client as is; a handler's bug may carry a
// key (a provider's reply, a server's stderr), so every handler of `mete daemon` runs guarded: a
// ResponseError passes, anything else is masked through secrets.mask@1 and answered as an internal
// error. Without the masker the message is withheld altogether, from the client and from stderr.

const GENERIC = "internal error";

type Handler = (...args: unknown[]) => unknown;
type Guarded = {
	onRequest: (method: unknown, handler: unknown) => { dispose(): void };
};

/** The masker when secrets.mask@1 is active. */
export const maskerOf = (app: App) => (): SecretsMaskAdapter | undefined => {
	const r = app.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	return r.ok ? r.value[0].impl : undefined;
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const maskedMessage = async (
	e: unknown,
	mask: SecretsMaskAdapter | undefined,
) => {
	if (!mask) return GENERIC;
	try {
		return (await mask.mask(messageOf(e))).text;
	} catch {
		return GENERIC;
	}
};

const guard =
	(
		method: string,
		handler: Handler,
		mask: () => SecretsMaskAdapter | undefined,
		log: (line: string) => void,
	): Handler =>
	async (...args) => {
		try {
			return await handler(...args);
		} catch (e) {
			if (e instanceof ResponseError) throw e;
			const text = await maskedMessage(e, mask());
			log(`${method} failed: ${text}`);
			throw new ResponseError(ErrorCodes.InternalError, text);
		}
	};

/**
 * The connection with every `onRequest` handler guarded; the other members are the connection's own.
 * `log` is the daemon's stderr line writer.
 */
export const guardedConnection = (
	conn: MessageConnection,
	mask: () => SecretsMaskAdapter | undefined,
	log: (line: string) => void,
): MessageConnection => {
	const guarded: Guarded = {
		onRequest: (method, handler) =>
			conn.onRequest(
				method as string,
				guard(String(method), handler as Handler, mask, log),
			),
	};
	return new Proxy(conn, {
		get: (target, key, receiver) =>
			key === "onRequest"
				? guarded.onRequest
				: Reflect.get(target, key, receiver),
	});
};
