import { randomUUID } from "node:crypto";
import { err, ok, type Result, type SecretStore } from "@mete/contracts";
import type {
	OAuthClientProvider,
	OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import type {
	OAuthClientInformationSchema,
	OAuthTokensSchema,
} from "@modelcontextprotocol/core";
import type { z } from "zod";

// OAuth for a remote MCP server (docs/10, MCP client, Authentication): the SDK's provider over the
// keychain. The redirect address is fixed and nothing listens on it; the user pastes the address the
// browser lands on, so the host needs no port and it works over SSH.

/** The redirect address registered for every server; the browser shows a connection error there. */
export const REDIRECT_URL = "http://127.0.0.1/callback";

/** The code the browser came back with, and the issuer it names, which the SDK checks (RFC 9207, ADR-163). */
export type Callback = { readonly code: string; readonly iss?: string };

/** A sign-in in progress: the provider the transport asks, the address it wants opened, and the check of the pasted one. */
export type SignInFlow = {
	readonly provider: OAuthClientProvider;
	readonly url: () => URL | undefined;
	readonly codeFrom: (pasted: string) => Result<Callback, string>;
};

/** The authorization code in the address the browser landed on, if it belongs to the sign-in with `state`. */
export const codeFromAddress = (
	pasted: string,
	state: string,
): Result<Callback, string> => {
	let address: URL;
	try {
		address = new URL(pasted.trim());
	} catch {
		return err("paste the whole address the browser landed on");
	}
	const params = address.searchParams;
	if (params.get("state") !== state)
		return err("that address does not belong to this sign-in");
	const refused = params.get("error");
	if (refused) return err(`the server refused the sign-in: ${refused}`);
	const code = params.get("code");
	if (!code) return err("that address carries no code");
	const iss = params.get("iss");
	return ok(iss ? { code, iss } : { code });
};

// One keychain entry per resource server, not per mcp.yaml id: tokens belong to the server,
// and two workspaces may use the same id for different servers.
const entry = (origin: string, what: "tokens" | "client") =>
	`mcp/${origin}/${what}`;

// The Windows keychain keeps at most 1280 characters in one entry (measured), and a JWT pair is
// longer, so a value is cut into numbered entries `<name>/0`, `<name>/1` ... and `<name>` holds how many.
// shortcut: pieces of an older, longer value are left behind; upgrade if the keychain fills up.
const PIECE_CHARS = 1000;
const MAX_PIECES = 64;

const put = async (secrets: SecretStore, name: string, value: string) => {
	const saved = await secrets.set(name, value);
	if (!saved.ok) throw new Error(`keychain: ${saved.error.message}`);
};

const write = async (secrets: SecretStore, name: string, value: unknown) => {
	const text = JSON.stringify(value);
	const count = Math.ceil(text.length / PIECE_CHARS);
	for (let i = 0; i < count; i++)
		await put(
			secrets,
			`${name}/${i}`,
			text.slice(i * PIECE_CHARS, (i + 1) * PIECE_CHARS),
		);
	await put(secrets, name, String(count));
};

// The pieces joined, or undefined when any is missing; the count goes last when written, so a half write is not read.
const readText = async (secrets: SecretStore, name: string) => {
	const stored = await secrets.get(name);
	const count = stored.ok ? Number(stored.value) : 0;
	if (!Number.isInteger(count) || count < 1 || count > MAX_PIECES)
		return undefined;
	let text = "";
	for (let i = 0; i < count; i++) {
		const piece = await secrets.get(`${name}/${i}`);
		if (!piece.ok || piece.value === undefined) return undefined;
		text += piece.value;
	}
	return text;
};

// The SDK's schemas load with the first keychain read, not when a command starts (docs/15, CLI cold start).
const schemas = () => import("@modelcontextprotocol/core");

const read = async <T>(
	secrets: SecretStore,
	name: string,
	schema: z.ZodType<T>,
): Promise<T | undefined> => {
	const text = await readText(secrets, name);
	if (text === undefined) return undefined;
	try {
		const parsed = schema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

// How METE registers: a native public client with PKCE, at the fixed redirect address (ADR-163).
const CLIENT: OAuthClientProvider["clientMetadata"] = {
	client_name: "METE",
	application_type: "native",
	redirect_uris: [REDIRECT_URL],
	grant_types: ["authorization_code", "refresh_token"],
	response_types: ["code"],
	token_endpoint_auth_method: "none",
};

type Saved = Pick<
	OAuthClientProvider,
	"clientInformation" | "saveClientInformation" | "tokens" | "saveTokens"
>;

// The tokens and the client of one origin, read from the keychain once and written through when they change.
const saved = (secrets: SecretStore, origin: string): Saved => {
	const names = {
		tokens: entry(origin, "tokens"),
		client: entry(origin, "client"),
	};
	let tokens: z.infer<typeof OAuthTokensSchema> | undefined;
	let client: z.infer<typeof OAuthClientInformationSchema> | undefined;
	return {
		clientInformation: async () =>
			(client ??= await read(
				secrets,
				names.client,
				(await schemas()).OAuthClientInformationSchema,
			)),
		saveClientInformation: async (info) => {
			client = info;
			await write(secrets, names.client, info);
		},
		tokens: async () =>
			(tokens ??= await read(
				secrets,
				names.tokens,
				(await schemas()).OAuthTokensSchema,
			)),
		saveTokens: async (next) => {
			tokens = next;
			await write(secrets, names.tokens, next);
		},
	};
};

/**
 * The sign-in of one resource server: a public client with PKCE, registered dynamically.
 * Tokens and the client are read from the keychain once and written through when they change.
 */
export const oauthSignIn = (
	secrets: SecretStore,
	resource: URL,
): SignInFlow => {
	const state = randomUUID();
	let verifier = "";
	// Kept beside the verifier: the SDK checks the callback's issuer against the one it found (ADR-163).
	let discovery: OAuthDiscoveryState | undefined;
	let pending: URL | undefined;
	const provider: OAuthClientProvider = {
		redirectUrl: REDIRECT_URL,
		clientMetadata: CLIENT,
		state: () => state,
		...saved(secrets, resource.origin),
		redirectToAuthorization: (url) => {
			pending = url;
		},
		saveCodeVerifier: (v) => {
			verifier = v;
		},
		codeVerifier: () => verifier,
		saveDiscoveryState: (found) => {
			discovery = found;
		},
		discoveryState: () => discovery,
	};
	return {
		provider,
		url: () => pending,
		codeFrom: (pasted) => codeFromAddress(pasted, state),
	};
};
