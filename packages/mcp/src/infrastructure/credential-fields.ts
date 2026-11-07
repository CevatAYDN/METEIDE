import {
	err,
	type McpCredentialWrite,
	McpCredentialWriteSchema,
	type McpServer,
	ok,
	type Result,
	type SecretError,
	type SecretStore,
	type ToolError,
} from "@mete/contracts";
import {
	credentialIdentity,
	credentialRecordName,
	credentialTargetAllowed,
} from "./credential-identity.js";
import { createCredentialRecords } from "./credential-records.js";

/** Private transport material; only configured booleans may cross management responses. */
export type CredentialFields = Pick<McpCredentialWrite, "fields" | "values">;

const failed = () =>
	err<ToolError>({
		code: "io",
		message: "MCP credentials could not be read or saved",
	});

const storedFields = (
	value: string,
	server: McpServer,
): Result<CredentialFields, ToolError> => {
	try {
		const parsed = McpCredentialWriteSchema.safeParse({
			...JSON.parse(value),
			expected: server,
		});
		return parsed.success
			? ok({ fields: parsed.data.fields, values: parsed.data.values })
			: failed();
	} catch {
		return failed();
	}
};

const mergeFields = (
	current: string | undefined,
	input: McpCredentialWrite,
): Result<string, SecretError> => {
	const old =
		current === undefined
			? ok(undefined)
			: storedFields(current, input.expected);
	if (!old.ok)
		return err({ code: "secret_failed", message: "Invalid credential record" });
	const fields = new Map(
		(old.value?.fields ?? []).map((field) => [
			`${field.kind}:${field.name}`,
			field,
		]),
	);
	for (const field of input.fields)
		fields.set(`${field.kind}:${field.name}`, field);
	const next = McpCredentialWriteSchema.safeParse({
		expected: input.expected,
		fields: [...fields.values()],
		values: { ...old.value?.values, ...input.values },
	});
	return next.success
		? ok(JSON.stringify({ fields: next.data.fields, values: next.data.values }))
		: err({ code: "secret_failed", message: "Invalid credential update" });
};

/** User fields share the exact target identity with OAuth, without modifying mcp.yaml. */
export const createCredentialFields = (
	secrets: SecretStore,
	workspaceDir: string,
) => {
	const records = createCredentialRecords(secrets);
	const name = async (server: McpServer) => {
		const identity = await credentialIdentity(workspaceDir, server);
		return identity.ok
			? ok(credentialRecordName(identity.value, "fields"))
			: identity;
	};
	return {
		load: async (
			server: McpServer,
		): Promise<Result<CredentialFields | undefined, ToolError>> => {
			const key = await name(server);
			if (!key.ok) return key;
			const record = await records.read(key.value);
			if (!record.ok) return failed();
			if (record.value === undefined) return ok(undefined);
			return storedFields(record.value, server);
		},
		save: async (
			input: McpCredentialWrite,
			signal: AbortSignal,
		): Promise<Result<void, ToolError>> => {
			const parsed = McpCredentialWriteSchema.safeParse(input);
			if (!parsed.success || !credentialTargetAllowed(input.expected))
				return err({
					code: "bad_input",
					message: "Invalid MCP credential fields or target",
				});
			const key = await name(parsed.data.expected);
			if (!key.ok) return key;
			const saved = await records.update(
				key.value,
				(current) => mergeFields(current, parsed.data),
				signal,
			);
			return saved.ok ? ok(undefined) : failed();
		},
		forget: async (server: McpServer): Promise<Result<void, ToolError>> => {
			const key = await name(server);
			if (!key.ok) return key;
			const removed = await records.delete(key.value);
			return removed.ok ? ok(undefined) : failed();
		},
	};
};

/** Exact-value redaction is applied before generic masking and before storing tool output. */
export const redactCredentials = (
	text: string,
	values: readonly string[],
): string =>
	[...new Set(values)]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length)
		.reduce((out, secret) => out.split(secret).join("[REDACTED]"), text);

/** The composition root's write-only stdin path; no secret-reading API is exported. */
export const writeMcpCredentials = (
	options: { readonly secrets: SecretStore; readonly workspaceDir: string },
	input: McpCredentialWrite,
	signal: AbortSignal,
) =>
	createCredentialFields(options.secrets, options.workspaceDir).save(
		input,
		signal,
	);
