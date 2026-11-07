import {
	err,
	type McpServer,
	McpServerSchema,
	ok,
	type Result,
	type SecretStore,
	type ToolError,
} from "@mete/contracts";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
	credentialIdentity,
	credentialRecordName,
	credentialTargetAllowed,
} from "./credential-identity.js";
import { createCredentialRecords } from "./credential-records.js";

/** Exact target and explicit interaction admission supplied by the connection owner. */
export type OAuthSignInOptions = {
	readonly secrets: SecretStore;
	readonly workspaceDir: string;
	readonly server: McpServer;
	readonly signal: AbortSignal;
	readonly interactive: boolean;
	readonly redirectUrl?: string;
	readonly onSecrets?: (values: readonly string[]) => void;
};

const failed = () =>
	err<ToolError>({
		code: "io",
		message: "MCP OAuth credential record unavailable",
	});
const issuerUrl = z.url().refine((value) => {
	const url = new URL(value);
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		!url.search &&
		!url.hash
	);
});
const redirectUrl = z.url().refine((value) => {
	const url = new URL(value);
	return (
		url.protocol === "http:" &&
		url.hostname === "127.0.0.1" &&
		!url.username &&
		!url.password &&
		!url.search &&
		!url.hash
	);
});

/** SDK schemas extended with mandatory issuer stamps; registration and tokens form one bound record. */
export const oauthRecordSchema = async () => {
	const { OAuthClientInformationSchema, OAuthTokensSchema } = await import(
		"@modelcontextprotocol/core"
	);
	const issuer = issuerUrl;
	return z
		.strictObject({
			resource: z.url(),
			redirectUrl,
			issuer,
			clientId: z.string().min(1),
			client: OAuthClientInformationSchema.extend({
				issuer,
				client_id: z.string().min(1),
			}),
			tokens: OAuthTokensSchema.extend({
				issuer,
				access_token: z.string().min(1),
			}),
		})
		.refine(
			(record) =>
				record.clientId === record.client.client_id &&
				record.issuer === record.client.issuer &&
				record.issuer === record.tokens.issuer,
		);
};

/** The internal atomic OAuth record, including SDK issuer stamps and exact resource/client/redirect binding. */
export type OAuthRecord = z.infer<
	Awaited<ReturnType<typeof oauthRecordSchema>>
>;

/** Per-flow memory only; registration and tokens persist only through explicit commit. */
export type OAuthPending = {
	client: OAuthRecord["client"] | undefined;
	tokens: OAuthRecord["tokens"] | undefined;
	discovery: OAuthDiscoveryState | undefined;
	readonly resource: string;
	readonly name: string;
	readonly redirectUrl: string;
	readonly state: string;
	verifier: string;
	url: URL | undefined;
	failed: boolean;
	dirty: boolean;
	callbackUsed: boolean;
	live: OAuthRecord | undefined;
	committing: Promise<Result<void, ToolError>> | undefined;
};

/** Resolves an OAuth-only exact target without reading secrets or making a connection. */
export const oauthTarget = async (
	workspaceDir: string,
	server: McpServer,
): Promise<
	Result<{ readonly name: string; readonly resource: string }, ToolError>
> => {
	const parsed = McpServerSchema.safeParse(server);
	if (!parsed.success)
		return err({
			code: "bad_input",
			message: "Invalid MCP OAuth credential target",
		});
	server = parsed.data;
	if (
		server.transport === "stdio" ||
		server.auth !== "oauth" ||
		!credentialTargetAllowed(server)
	)
		return err({
			code: "bad_input",
			message: "Invalid MCP OAuth credential target",
		});
	const identity = await credentialIdentity(workspaceDir, server);
	return identity.ok
		? ok({
				name: credentialRecordName(identity.value, "oauth"),
				resource: new URL(server.url).href,
			})
		: identity;
};

const publishOAuthRecord = async (
	options: OAuthSignInOptions,
	name: string,
	record: OAuthRecord,
): Promise<Result<void, ToolError>> => {
	const saved = await createCredentialRecords(options.secrets).write(
		name,
		JSON.stringify(record),
		options.signal,
	);
	return saved.ok
		? ok(undefined)
		: err({
				code: "io",
				message: saved.error.message.startsWith("Credential committed; ")
					? "MCP OAuth credentials committed; cleanup incomplete"
					: "MCP OAuth credential commit failed",
			});
};

const commitInitial = async (
	options: OAuthSignInOptions,
	pending: OAuthPending,
	schema: Awaited<ReturnType<typeof oauthRecordSchema>>,
): Promise<Result<void, ToolError>> => {
	if (pending.failed || options.signal.aborted)
		return err({
			code: "io",
			message: "MCP OAuth sign-in cancelled or failed",
		});
	if (pending.live && !pending.dirty) return ok(undefined);
	const parsed = schema.safeParse({
		resource: pending.resource,
		redirectUrl: pending.redirectUrl,
		issuer: pending.client?.issuer,
		clientId: pending.client?.client_id,
		client: pending.client,
		tokens: pending.tokens,
	});
	if (!parsed.success) return failed();
	const saved = pending.dirty
		? await publishOAuthRecord(options, pending.name, parsed.data)
		: ok(undefined);
	if (saved.ok) {
		pending.live = parsed.data;
		pending.dirty = false;
	}
	return saved;
};

/** Coalesces only the current handshake commit; later staged authorization may commit again. */
export const commitOAuthRecord = (
	options: OAuthSignInOptions,
	pending: OAuthPending,
	schema: Awaited<ReturnType<typeof oauthRecordSchema>>,
): Promise<Result<void, ToolError>> =>
	(pending.committing ??= commitInitial(options, pending, schema).finally(
		() => {
			pending.committing = undefined;
		},
	));

/** Before handshake, stages tokens; afterward, publishes bound rotations before replacing usable memory. */
export const saveOAuthTokens = async (
	options: OAuthSignInOptions,
	pending: OAuthPending,
	tokens: OAuthRecord["tokens"],
): Promise<void> => {
	if (!pending.live) {
		if (pending.committing)
			throw new Error("MCP OAuth credential commit in progress");
		pending.tokens = tokens;
		pending.dirty = true;
		return;
	}
	const live = pending.live;
	if (
		tokens.issuer !== live.issuer ||
		pending.client?.client_id !== live.clientId ||
		pending.resource !== live.resource ||
		pending.redirectUrl !== live.redirectUrl
	)
		throw new Error("MCP OAuth credential binding changed");
	const record = { ...live, tokens };
	const saved = await publishOAuthRecord(options, pending.name, record);
	// SDK hooks must reject on failure; leave the last durable token usable for retry.
	if (!saved.ok) throw new Error(saved.error.message);
	pending.tokens = tokens;
	pending.live = record;
};

/** Reads only a validated exact-resource record; missing is distinct from partial or corrupt. */
export const readOAuthRecord = async (
	secrets: SecretStore,
	name: string,
	resource: string,
): Promise<Result<OAuthRecord | undefined, ToolError>> => {
	const text = await createCredentialRecords(secrets).read(name);
	if (!text.ok) return failed();
	if (text.value === undefined) return ok(undefined);
	try {
		const schema = await oauthRecordSchema();
		const parsed = schema.safeParse(JSON.parse(text.value));
		return parsed.success && parsed.data.resource === resource
			? ok(parsed.data)
			: failed();
	} catch {
		return failed();
	}
};

/** Safe local configured status: never connects, registers, or exposes secret values. */
export const oauthConfigured = async (
	secrets: SecretStore,
	workspaceDir: string,
	server: McpServer,
): Promise<Result<boolean, ToolError>> => {
	if (server.transport === "stdio" || server.auth !== "oauth") return ok(false);
	const target = await oauthTarget(workspaceDir, server);
	if (!target.ok) return target;
	const record = await readOAuthRecord(
		secrets,
		target.value.name,
		target.value.resource,
	);
	return record.ok ? ok(record.value !== undefined) : record;
};

/** Deletes the exact local OAuth record; incomplete cleanup is an error, never remote revocation. */
export const forgetOAuth = async (
	secrets: SecretStore,
	workspaceDir: string,
	server: McpServer,
): Promise<Result<void, ToolError>> => {
	if (server.transport === "stdio" || server.auth !== "oauth")
		return ok(undefined);
	const target = await oauthTarget(workspaceDir, server);
	if (!target.ok) return target;
	const deleted = await createCredentialRecords(secrets).delete(
		target.value.name,
	);
	return deleted.ok ? ok(undefined) : failed();
};
