import { randomUUID } from "node:crypto";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import {
	OAUTH_CALLBACK_CODE_CHARS,
	OAUTH_CALLBACK_STATE_CHARS,
	OAUTH_CALLBACK_URL_CHARS,
} from "../defaults.js";
import {
	commitOAuthRecord,
	type OAuthRecord,
	type OAuthSignInOptions,
	oauthRecordSchema,
	oauthTarget,
	type OAuthPending as Pending,
	readOAuthRecord,
	saveOAuthTokens,
} from "./oauth-record.js";

/** Exact-target local status and Forget; neither starts OAuth interaction. */
export {
	forgetOAuth,
	type OAuthSignInOptions,
	oauthConfigured,
} from "./oauth-record.js";

/** Default terminal paste-back address; desktop flows supply their temporary loopback callback. */
export const REDIRECT_URL = "http://127.0.0.1/callback";

/** The code the browser came back with, and the issuer it names, which the SDK checks (RFC 9207, ADR-163). */
export type Callback = { readonly code: string; readonly iss?: string };

/** A sign-in in progress: the provider the transport asks, the address it wants opened, and the check of the pasted one. */
export type SignInFlow = {
	readonly provider: OAuthClientProvider;
	readonly url: () => URL | undefined;
	readonly codeFrom: (pasted: string) => Result<Callback, string>;
	/** Caller invokes this only after successful handshake and tools/list. */
	readonly commit: () => Promise<Result<void, ToolError>>;
};

/** The authorization code in the address the browser landed on, if it belongs to the sign-in with `state`. */
export const codeFromAddress = (
	pasted: string,
	state: string,
	redirectUrl = REDIRECT_URL,
): Result<Callback, string> => {
	if (
		pasted.length > OAUTH_CALLBACK_URL_CHARS ||
		state.length > OAUTH_CALLBACK_STATE_CHARS
	)
		return err("invalid sign-in callback");
	let address: URL;
	let redirect: URL;
	try {
		address = new URL(pasted.trim());
		redirect = new URL(redirectUrl);
	} catch {
		return err("paste the whole address the browser landed on");
	}
	if (!sameRoute(address, redirect))
		return err("that address does not belong to this sign-in");
	const params = address.searchParams;
	if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
		return err("invalid sign-in callback");
	if (params.get("state") !== state)
		return err("that address does not belong to this sign-in");
	const refused = params.get("error");
	if (refused !== null) return err("the server refused the sign-in");
	const code = params.get("code");
	if (!code) return err("that address carries no code");
	if (code.length > OAUTH_CALLBACK_CODE_CHARS)
		return err("invalid sign-in callback");
	const iss = params.get("iss");
	return ok(iss ? { code, iss } : { code });
};

const sameRoute = (address: URL, redirect: URL) =>
	address.origin === redirect.origin &&
	address.pathname === redirect.pathname &&
	!address.hash &&
	!address.username &&
	!address.password;
type RecordSchema = Awaited<ReturnType<typeof oauthRecordSchema>>;
const fail = (message: string) => err<ToolError>({ code: "io", message });
const SIGN_IN_NEEDED =
	"you need to sign in; sign in once with `mete run` in a terminal";

// SDK hooks cannot return Result: a fixed exception aborts its network flow; public operations return Result.
const reject = (
	pending: Pending,
	message = "MCP OAuth sign-in failed",
): never => {
	pending.failed = true;
	throw new Error(message);
};
const active = (pending: Pending, signal: AbortSignal) => {
	if (pending.failed || signal.aborted) reject(pending);
};
const bound = <T extends { issuer: string }>(
	pending: Pending,
	value: T | undefined,
	context?: { readonly issuer: string },
) => {
	if (value && context && value.issuer !== context.issuer)
		reject(pending, "MCP OAuth issuer mismatch");
	const expected =
		pending.discovery?.authorizationServerMetadata?.issuer ??
		pending.discovery?.authorizationServerUrl ??
		pending.client?.issuer;
	if (value && expected && value.issuer !== expected)
		reject(pending, "MCP OAuth issuer mismatch");
	return value;
};
const notify = (options: OAuthSignInOptions, pending: Pending) => {
	const values = [
		pending.tokens?.access_token,
		pending.tokens?.refresh_token,
		pending.client?.client_secret,
		pending.verifier,
	];
	try {
		options.onSecrets?.(
			values.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			),
		);
	} catch {
		reject(pending);
	}
};

const credentialHooks = (
	options: OAuthSignInOptions,
	pending: Pending,
	schema: RecordSchema,
	interactive: boolean,
): Pick<
	OAuthClientProvider,
	"clientInformation" | "saveClientInformation" | "tokens" | "saveTokens"
> => {
	const saveClientInformation: NonNullable<
		OAuthClientProvider["saveClientInformation"]
	> = (info, context) => {
		active(pending, options.signal);
		const parsed = schema.shape.client.safeParse(info);
		if (!parsed.success) return reject(pending);
		bound(pending, parsed.data, context);
		if (pending.live) {
			if (JSON.stringify(parsed.data) !== JSON.stringify(pending.live.client))
				reject(pending);
			return;
		}
		pending.client = parsed.data;
		pending.dirty = true;
		notify(options, pending);
	};
	return {
		...(interactive ? { saveClientInformation } : {}),
		clientInformation: (context) => {
			active(pending, options.signal);
			return bound(pending, pending.client, context);
		},
		tokens: (context) => {
			active(pending, options.signal);
			return bound(pending, pending.tokens, context);
		},
		saveTokens: async (next, context) => {
			active(pending, options.signal);
			const parsed = schema.shape.tokens.safeParse(next);
			if (!parsed.success) return reject(pending);
			if (parsed.data.issuer !== pending.client?.issuer) reject(pending);
			bound(pending, parsed.data, context);
			notify(options, { ...pending, tokens: parsed.data });
			await saveOAuthTokens(options, pending, parsed.data);
		},
	};
};

const interactionHooks = (
	options: OAuthSignInOptions,
	pending: Pending,
	interactive: boolean,
) => ({
	state: () => pending.state,
	codeVerifier: () => {
		active(pending, options.signal);
		return pending.verifier;
	},
	saveCodeVerifier: (value: string) => {
		active(pending, options.signal);
		if (!interactive) reject(pending, SIGN_IN_NEEDED);
		pending.verifier = value;
		notify(options, pending);
	},
	redirectToAuthorization: (url: URL) => {
		active(pending, options.signal);
		if (!interactive) reject(pending, SIGN_IN_NEEDED);
		if (url.protocol !== "https:" || url.username || url.password || url.hash)
			reject(pending);
		pending.url = url;
	},
	invalidateCredentials: (
		scope: "all" | "client" | "tokens" | "verifier" | "discovery",
	) => {
		active(pending, options.signal);
		if (!interactive) reject(pending, SIGN_IN_NEEDED);
		invalidatePending(pending, scope);
	},
});

const invalidatePending = (pending: Pending, scope: string) => {
	if (["all", "client", "tokens"].includes(scope)) pending.live = undefined;
	if (["all", "client"].includes(scope)) pending.client = undefined;
	if (["all", "client", "tokens"].includes(scope)) pending.tokens = undefined;
	if (["all", "verifier"].includes(scope)) pending.verifier = "";
	if (["all", "discovery"].includes(scope)) pending.discovery = undefined;
};

const discoveryHooks = (
	options: OAuthSignInOptions,
	pending: Pending,
): Partial<OAuthClientProvider> => ({
	saveDiscoveryState: (found) => {
		active(pending, options.signal);
		const issuer =
			found.authorizationServerMetadata?.issuer ?? found.authorizationServerUrl;
		if (pending.client && issuer !== pending.client.issuer)
			reject(pending, "MCP OAuth issuer mismatch");
		pending.discovery = found;
	},
	discoveryState: () => pending.discovery,
	validateResourceURL: async (serverUrl, resource) => {
		active(pending, options.signal);
		if (
			!matchesResource(serverUrl, pending.resource) ||
			(resource && !matchesResource(resource, pending.resource))
		)
			reject(pending);
		return new URL(pending.resource);
	},
	saveResourceUrl: (resource) => {
		active(pending, options.signal);
		if (!matchesResource(resource, pending.resource)) reject(pending);
	},
});

const matchesResource = (value: string | URL, resource: string) => {
	try {
		return new URL(value).href === resource;
	} catch {
		return false;
	}
};

const providerFor = (
	options: OAuthSignInOptions,
	pending: Pending,
	schema: RecordSchema,
	interactive: boolean,
): OAuthClientProvider => ({
	redirectUrl: pending.redirectUrl,
	clientMetadata: {
		client_name: "METE",
		application_type: "native",
		redirect_uris: [pending.redirectUrl],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
	},
	...credentialHooks(options, pending, schema, interactive),
	...interactionHooks(options, pending, interactive),
	...discoveryHooks(options, pending),
});

const callbackFor = (
	pending: Pending,
	options: OAuthSignInOptions,
	pasted: string,
): Result<Callback, string> => {
	if (pending.failed || pending.callbackUsed || options.signal.aborted)
		return err("sign-in callback unavailable");
	const callback = codeFromAddress(pasted, pending.state, pending.redirectUrl);
	const issuer =
		pending.discovery?.authorizationServerMetadata?.issuer ??
		pending.discovery?.authorizationServerUrl ??
		pending.client?.issuer;
	if (
		!callback.ok ||
		(callback.value.iss && issuer && callback.value.iss !== issuer)
	) {
		pending.failed = true;
		return callback.ok ? err("MCP OAuth issuer mismatch") : callback;
	}
	pending.callbackUsed = true;
	return callback;
};

const redirectFor = (value: string): Result<string, ToolError> => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" &&
			url.hostname === "127.0.0.1" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
			? ok(url.href)
			: fail("Invalid MCP OAuth callback target");
	} catch {
		return fail("Invalid MCP OAuth callback target");
	}
};

const pendingFor = (
	record: OAuthRecord | undefined,
	resource: string,
	redirectUrl: string,
	name: string,
): Pending => ({
	client: record?.client,
	tokens: record?.tokens,
	discovery: undefined,
	resource,
	name,
	redirectUrl,
	state: randomUUID(),
	verifier: "",
	url: undefined,
	failed: false,
	dirty: false,
	callbackUsed: false,
	live: undefined,
	committing: undefined,
});
const defaultRedirect = (
	options: OAuthSignInOptions,
	record: OAuthRecord | undefined,
) => {
	if (options.interactive && options.redirectUrl !== undefined)
		return options.redirectUrl;
	return record?.redirectUrl ?? options.redirectUrl ?? REDIRECT_URL;
};
const reusableRecord = (
	options: OAuthSignInOptions,
	record: OAuthRecord | undefined,
) =>
	options.interactive && options.redirectUrl !== undefined ? undefined : record;
/** Creates an exact-target SDK flow; writes are staged until the caller commits after handshake/tools-list. */
export const oauthSignIn = async (
	options: OAuthSignInOptions,
): Promise<Result<SignInFlow, ToolError>> => {
	if (options.signal.aborted) return fail("MCP OAuth sign-in cancelled");
	const target = await oauthTarget(options.workspaceDir, options.server);
	if (!target.ok) return target;
	const saved = await readOAuthRecord(
		options.secrets,
		target.value.name,
		target.value.resource,
	);
	if (!saved.ok) return saved;
	const redirect = redirectFor(defaultRedirect(options, saved.value));
	if (!redirect.ok) return redirect;
	const record = reusableRecord(options, saved.value);
	if (!record && !options.interactive) return fail(SIGN_IN_NEEDED);
	const pending = pendingFor(
		record,
		target.value.resource,
		redirect.value,
		target.value.name,
	);
	const schema = await oauthRecordSchema();
	if (options.signal.aborted) return fail("MCP OAuth sign-in cancelled");
	try {
		notify(options, pending);
	} catch {
		return fail("MCP OAuth sign-in failed");
	}
	return ok({
		provider: providerFor(options, pending, schema, options.interactive),
		url: () => pending.url,
		codeFrom: (pasted) => callbackFor(pending, options, pasted),
		commit: () => commitOAuthRecord(options, pending, schema),
	});
};
