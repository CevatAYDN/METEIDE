import { z } from "zod";
import { MCP_CREDENTIAL_FIELDS_MAX } from "../defaults.js";

/** Configuration may name required fields, but never stores their values. */
export const McpCredentialFieldSchema = z
	.strictObject({
		kind: z.enum(["env", "header"]),
		name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
		required: z.boolean(),
		secret: z.boolean(),
		description: z.string().optional(),
	})
	.refine((f) => f.kind !== "env" || /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name));
export type McpCredentialField = z.infer<typeof McpCredentialFieldSchema>;

/** HTTP field names are case insensitive; duplicates cannot shadow credentials. */
export const McpCredentialFieldsSchema = z
	.array(McpCredentialFieldSchema)
	.max(MCP_CREDENTIAL_FIELDS_MAX)
	.refine(
		(list) =>
			new Set(list.map((f) => `${f.kind}:${f.name.toLowerCase()}`)).size ===
			list.length,
	);
