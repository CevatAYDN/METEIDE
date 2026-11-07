import { z } from "zod";
import { MCP_CREDENTIAL_VALUE_CHARS } from "../defaults.js";
import {
	type McpCredentialField,
	McpCredentialFieldSchema,
	McpCredentialFieldsSchema,
} from "./mcp-credential-field.js";

export {
	type McpCredentialField,
	McpCredentialFieldSchema,
} from "./mcp-credential-field.js";

import { type McpServer, McpServerSchema } from "./mcp.js";
import type { Result } from "./result.js";
import type { ToolContext, ToolError } from "./tools.js";

const text = z.string().min(1);
const expected = McpServerSchema;
const attemptId = z.uuid();

const fields = McpCredentialFieldsSchema;

/** Local, non-connecting state; configured credentials are not handshake evidence. */
export const McpConnectionStateSchema = z.strictObject({
	id: text,
	identity: z.string().regex(/^[a-f0-9]{64}$/),
	phase: z.enum([
		"needs_sign_in",
		"needs_credentials",
		"untested",
		"configured",
		"pending",
		"connected",
		"cancelled",
		"expired",
		"failed",
	]),
	fields: z.array(
		McpCredentialFieldSchema.safeExtend({ configured: z.boolean() }),
	),
	attemptId: attemptId.optional(),
	expiresAt: z.iso.datetime().optional(),
	failure: z
		.enum([
			"sign_in_failed",
			"credentials_failed",
			"unsupported",
			"cancelled",
			"expired",
		])
		.optional(),
});
export type McpConnectionState = z.infer<typeof McpConnectionStateSchema>;

/** Start alone may return an authorization URL; never tokens or callback codes. */
export const McpSignInStartedSchema = z.strictObject({
	state: McpConnectionStateSchema,
	authorizationUrl: z.url({ protocol: /^https$/ }).optional(),
});
export type McpSignInStarted = z.infer<typeof McpSignInStartedSchema>;

/** Protocol33 management request; cancellation addresses one captured attempt. */
export const McpConnectionRequestSchema = z.discriminatedUnion("op", [
	z.strictObject({ op: z.enum(["status", "start", "forget"]), expected }),
	z.strictObject({ op: z.literal("cancel"), expected, attemptId }),
]);
export type McpConnectionRequest = z.infer<typeof McpConnectionRequestSchema>;

const CredentialWriteShape = z.strictObject({
	expected,
	fields,
	values: z.record(
		text,
		z
			.string()
			.min(1)
			.max(MCP_CREDENTIAL_VALUE_CHARS)
			.regex(/^[^\r\n\0]+$/),
	),
});
type WriteInput = z.infer<typeof CredentialWriteShape>;

const headerIssue = (field: McpCredentialField, server: McpServer) => {
	if (field.kind !== "header") return undefined;
	if (
		server.transport !== "stdio" &&
		server.auth === "oauth" &&
		field.name.toLowerCase() === "authorization"
	)
		return "OAuth cannot use a manual Authorization header";
	if (
		/^(host|connection|content-length|transfer-encoding|proxy-authorization|cookie)$/i.test(
			field.name,
		)
	)
		return "Reserved connection header";
	return undefined;
};
const fieldIssue = (field: McpCredentialField, input: WriteInput) => {
	if ((field.kind === "env") !== (input.expected.transport === "stdio"))
		return "Field does not belong to this transport";
	if (field.required && !input.values[`${field.kind}:${field.name}`])
		return "Required credential is missing";
	return headerIssue(field, input.expected);
};
const retainedRequirements = (input: WriteInput) =>
	(input.expected.credentialFields ?? []).every(
		(required) =>
			input.fields.some(
				(f) =>
					f.kind === required.kind &&
					f.name === required.name &&
					f.required === required.required &&
					f.secret === required.secret,
			) &&
			(!required.required ||
				Boolean(input.values[`${required.kind}:${required.name}`])),
	);

/** Write-only stdin boundary, never accepted by the daemon's read/status route. */
export const McpCredentialWriteSchema = CredentialWriteShape.refine(
	(input) =>
		Object.keys(input.values).every((key) =>
			input.fields.some((f) => `${f.kind}:${f.name}` === key),
		),
	"Unknown credential field",
)
	.refine(
		retainedRequirements,
		"Configured server requirements must be retained",
	)
	.superRefine((input, ctx) => {
		for (const field of input.fields) {
			const message = fieldIssue(field, input);
			if (message) ctx.addIssue({ code: "custom", message });
		}
	});
export type McpCredentialWrite = z.infer<typeof McpCredentialWriteSchema>;

/** mcp.connection@1 is user management, absent from the model tool catalog. */
export interface McpConnectionAdapter {
	status(
		server: McpServer,
		signal: AbortSignal,
	): Promise<Result<McpConnectionState, ToolError>>;
	start(
		server: McpServer,
		signal: AbortSignal,
	): Promise<Result<McpSignInStarted, ToolError>>;
	cancel(
		server: McpServer,
		attemptId: string,
	): Promise<Result<McpConnectionState, ToolError>>;
	forget(
		server: McpServer,
		signal: AbortSignal,
	): Promise<Result<McpConnectionState, ToolError>>;
	configure(
		input: McpCredentialWrite,
		signal: AbortSignal,
	): Promise<Result<McpConnectionState, ToolError>>;
}

/** Structured registry requirements, separate from protocol29's unmodified draft. */
export const RegistrySetupResultSchema = z.strictObject({
	server: McpServerSchema,
	notes: z.array(z.string()),
	source: text,
	fields,
	blocked: z.boolean(),
});
export type RegistrySetupResult = z.infer<typeof RegistrySetupResultSchema>;

/** registry.setup@1 prepares user-reviewed requirements without installation. */
export interface RegistrySetupAdapter {
	prepare(
		name: string,
		ctx: ToolContext,
	): Promise<Result<RegistrySetupResult, ToolError>>;
}
