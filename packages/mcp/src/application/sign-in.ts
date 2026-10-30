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

/** Shows `url` to the user and returns the address they pasted back; undefined when they gave up. */
export type Authorize = (
	server: string,
	url: string,
	signal: AbortSignal,
) => Promise<string | undefined>;

const failed = (server: McpServer, message: string): ToolError => ({
	code: "io",
	message: `MCP server ${server.id}: ${message}`,
});

/** A connection that was refused for lack of a sign-in: what to sign in to and the transport that finishes it. */
export type Refused = {
	readonly server: McpServer;
	readonly flow: SignInFlow;
	readonly opened: Opened;
};

/** Runs the sign-in the failed connection asked for; the next connection then has tokens. */
export const signIn = async (
	authorize: Authorize | undefined,
	{ server, flow, opened }: Refused,
	signal: AbortSignal,
): Promise<Result<void, ToolError>> => {
	const url = flow.url();
	if (!url) return err(failed(server, "refused the saved sign-in"));
	if (!authorize)
		return err(
			failed(
				server,
				"you need to sign in; sign in once with `mete run` in a terminal",
			),
		);
	const pasted = await authorize(server.id, url.href, signal);
	if (pasted === undefined)
		return err(
			failed(
				server,
				"no sign-in was given; sign in once with `mete run` in a terminal",
			),
		);
	const code = flow.codeFrom(pasted);
	if (!code.ok) return err(failed(server, code.error));
	try {
		await opened.finishAuth?.(code.value.code, code.value.iss);
		return ok(undefined);
	} catch (e) {
		return err(failed(server, e instanceof Error ? e.message : String(e)));
	}
};
