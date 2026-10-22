import { randomUUID } from "node:crypto";
import { err, ok, type Result, type SecretStore } from "@mete/contracts";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
	OAuthClientInformationSchema,
	OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { z } from "zod";

// OAuth for a remote MCP server (docs/10, MCP client, Authentication): the SDK's provider over the
// keychain. The redirect address is fixed and nothing listens on it; the user pastes the address the
// browser lands on, so the host needs no port and it works over SSH.

/** The redirect address registered for every server; the browser shows a connection error there. */
export const REDIRECT_URL = "http://127.0.0.1/callback";

/** A sign-in in progress: the provider the transport asks, the address it wants opened, and the check of the pasted one. */
export type SignInFlow = {
	readonly provider: OAuthClientProvider;
	readonly url: () => URL | undefined;
	readonly codeFrom: (pasted: string) => Result<string, string>;
};

/** The authorization code in the address the browser landed on, if it belongs to the sign-in with `state`. */
export const codeFromAddress = (
	pasted: string,
	state: string,
): Result<string, string> => {
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
	return code ? ok(code) : err("that address carries no code");
};

// One keychain entry per resource server, not per mcp.yaml id: tokens belong to the server,
// and two workspaces may use the same id for different servers.
const entry = (origin: string, what: "tokens" | "client") =>
	`mcp/${origin}/${what}`;

const read = async <T>(
	secrets: SecretStore,
	name: string,
	schema: z.ZodType<T>,
): Promise<T | undefined> => {
	const stored = await secrets.get(name);
	if (!stored.ok || !stored.value) return undefined;
	try {
		const parsed = schema.safeParse(JSON.parse(stored.value));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

const write = async (secrets: SecretStore, name: string, value: unknown) => {
	const saved = await secrets.set(name, JSON.stringify(value));
	if (!saved.ok) throw new Error(`keychain: ${saved.error.message}`);
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
	const names = {
		tokens: entry(resource.origin, "tokens"),
		client: entry(resource.origin, "client"),
	};
	let verifier = "";
	let pending: URL | undefined;
	let tokens: z.infer<typeof OAuthTokensSchema> | undefined;
	let client: z.infer<typeof OAuthClientInformationSchema> | undefined;
	const provider: OAuthClientProvider = {
		redirectUrl: REDIRECT_URL,
		clientMetadata: {
			client_name: "METE",
			redirect_uris: [REDIRECT_URL],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
		state: () => state,
		clientInformation: async () =>
			(client ??= await read(
				secrets,
				names.client,
				OAuthClientInformationSchema,
			)),
		saveClientInformation: async (info) => {
			client = info;
			await write(secrets, names.client, info);
		},
		tokens: async () =>
			(tokens ??= await read(secrets, names.tokens, OAuthTokensSchema)),
		saveTokens: async (saved) => {
			tokens = saved;
			await write(secrets, names.tokens, saved);
		},
		redirectToAuthorization: (url) => {
			pending = url;
		},
		saveCodeVerifier: (v) => {
			verifier = v;
		},
		codeVerifier: () => verifier,
	};
	return {
		provider,
		url: () => pending,
		codeFrom: (pasted) => codeFromAddress(pasted, state),
	};
};
