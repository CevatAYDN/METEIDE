import {
	err,
	type McpServer,
	ok,
	type Result,
	type ToolError,
} from "@mete/contracts";
import type { SignInFlow } from "../infrastructure/oauth.js";
import type { Opened } from "../infrastructure/transport.js";

// The first sign-in of a remote server (docs/10, MCP client, Authentication): the host shows the
// user the address to open and brings back the address the browser landed on; later connections
// find the tokens in the keychain and ask nothing, whatever the host.

/**
 * Shows `url` to the user and returns the address they pasted back; undefined when they gave up.
 * `refused` says why the address pasted last time was not taken, so the user can see it.
 */
export type Authorize = (
	server: string,
	url: string,
	signal: AbortSignal,
	refused?: string,
) => Promise<string | undefined>;

/** What a server's sign-ins left in this process: why the last address was refused, and whether the user gave up. */
export type SignInMemory = { refused: string | undefined; declined: boolean };

const NOT_GIVEN =
	"no sign-in was given; sign in once with `mete run` in a terminal";

const failed = (server: McpServer, message: string): ToolError => ({
	code: "io",
	message: `MCP server ${server.id}: ${message}`,
});

// The pasted address's code traded for tokens; the reason when the address is not taken.
const finish = async (
	flow: SignInFlow,
	opened: Opened,
	pasted: string,
): Promise<Result<void, string>> => {
	const code = flow.codeFrom(pasted);
	if (!code.ok) return err(code.error);
	try {
		await opened.finishAuth?.(code.value.code, code.value.iss);
		return ok(undefined);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
};

/** A connection that was refused for lack of a sign-in: what to sign in to and the transport that finishes it. */
export type Refused = {
	readonly server: McpServer;
	readonly flow: SignInFlow;
	readonly opened: Opened;
};

/** How a sign-in ended: with tokens, with a pasted address that was refused (worth asking again), or stopped. */
export type SignedIn =
	| { readonly kind: "ok" }
	| { readonly kind: "refused" | "stopped"; readonly error: ToolError };

const stopped = (server: McpServer, message: string): SignedIn => ({
	kind: "stopped",
	error: failed(server, message),
});

/**
 * Runs the sign-in the failed connection asked for; the next connection then has tokens. A refused
 * address is remembered with its reason; a sign-in the user gave up is not asked for again (docs/10).
 */
export const signIn = async (
	authorize: Authorize | undefined,
	{ server, flow, opened }: Refused,
	signal: AbortSignal,
	memory: SignInMemory,
): Promise<SignedIn> => {
	const url = flow.url();
	if (!url) return stopped(server, "refused the saved sign-in");
	if (!authorize)
		return stopped(
			server,
			"you need to sign in; sign in once with `mete run` in a terminal",
		);
	if (memory.declined) return stopped(server, NOT_GIVEN);
	const pasted = await authorize(server.id, url.href, signal, memory.refused);
	if (pasted === undefined) {
		memory.declined = true;
		return stopped(server, NOT_GIVEN);
	}
	const done = await finish(flow, opened, pasted);
	memory.refused = done.ok ? undefined : done.error;
	if (done.ok) return { kind: "ok" };
	return { kind: "refused", error: failed(server, done.error) };
};
