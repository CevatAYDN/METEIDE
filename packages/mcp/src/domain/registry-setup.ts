import {
	err,
	type McpCredentialField,
	McpCredentialFieldSchema,
	ok,
	type RegistrySetupResult,
	RegistrySetupResultSchema,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { z } from "zod";
import {
	type Install,
	installOf,
	OfficialServerSchema,
} from "./registry-install.js";

const record = z.record(z.string(), z.unknown());
const records = z.array(record).default([]);
const Envelope = z.object({
	server: z.looseObject({
		name: z.string().min(1),
		version: z.string().min(1),
		packages: records,
		remotes: records,
	}),
});
const Metadata = z.looseObject({
	name: z.string().min(1).optional(),
	description: z.string().optional(),
	isRequired: z.boolean().default(false),
	isSecret: z.boolean().default(false),
	value: z.string().optional(),
	default: z.string().optional(),
	type: z.enum(["named", "positional"]).optional(),
	variables: z.never().optional(),
	choices: z.never().optional(),
	format: z.never().optional(),
	isRepeated: z.never().optional(),
	valueHint: z.never().optional(),
});
const reserved =
	/^(host|connection|content-length|transfer-encoding|proxy-authorization|cookie)$/i;
const template = /[{}]|\$\(/;
const bad = () =>
	err<ToolError>({
		code: "bad_input",
		message:
			"Registry entry has no safe pinned draft; choose a supported package or a concrete credential-free endpoint.",
	});
const unsupported =
	"Unsupported or malformed setup metadata; use supported named env/header fields or configure the server manually.";
type Requirements = {
	fields: McpCredentialField[];
	notes: string[];
	blocked: boolean;
};
const blocked = (): Requirements => ({
	fields: [],
	notes: [unsupported],
	blocked: true,
});

const fieldOf = (
	entry: z.output<typeof Metadata> & { name: string },
	kind: McpCredentialField["kind"],
) => {
	if (template.test(entry.value ?? "") || template.test(entry.default ?? ""))
		return undefined;
	const field = McpCredentialFieldSchema.safeParse({
		kind,
		name: entry.name,
		required: entry.isRequired,
		secret: entry.isSecret,
		...(entry.description === undefined
			? {}
			: { description: entry.description }),
	});
	if (!field.success || (kind === "header" && reserved.test(entry.name)))
		return undefined;
	return field.data;
};

const fieldsOf = (
	raw: unknown,
	kind: McpCredentialField["kind"],
): Requirements => {
	const list = z
		.array(Metadata.required({ name: true }))
		.default([])
		.safeParse(raw);
	if (!list.success) return blocked();
	const fields: McpCredentialField[] = [];
	for (const entry of list.data) {
		const field = fieldOf(entry, kind);
		if (!field) return blocked();
		fields.push(field);
	}
	const notes = fields
		.filter((f) => f.required)
		.map((f) =>
			kind === "env"
				? `set the environment variable ${f.name} under env`
				: `configure the required header ${f.name} through credential setup`,
		);
	return { fields, notes, blocked: false };
};

const argumentsOf = (entry: Record<string, unknown>): Requirements => {
	const args = z.array(Metadata).default([]).safeParse(entry.packageArguments);
	const runtime = z
		.array(z.unknown())
		.default([])
		.safeParse(entry.runtimeArguments);
	if (!args.success || !runtime.success || runtime.data.length)
		return blocked();
	if (
		args.data.some(
			(a) =>
				a.isSecret ||
				template.test(a.value ?? "") ||
				template.test(a.default ?? ""),
		)
	)
		return blocked();
	return {
		fields: [],
		blocked: args.data.some((a) => a.isRequired),
		notes: args.data
			.filter((a) => a.isRequired)
			.map((a) => `add the required argument ${a.name ?? "(unnamed)"} to args`),
	};
};

const safeTarget = (entry: Record<string, unknown>, remote: boolean) => {
	if (!remote)
		return (
			!template.test(String(entry.identifier)) &&
			!template.test(String(entry.version))
		);
	const url = z.url({ protocol: /^https?$/ }).safeParse(entry.url);
	if (!url.success || template.test(url.data)) return false;
	const target = new URL(url.data);
	return (
		!target.username &&
		!target.password &&
		![...target.searchParams.keys()].some((key) =>
			/key|token|secret|password|credential|authorization/i.test(key),
		)
	);
};

const requirementsOf = (
	entry: Record<string, unknown>,
	remote: boolean,
): Requirements => {
	const transport = record.safeParse(entry.transport);
	const keys = [
		"variables",
		"authentication",
		"auth",
		"env",
		...(remote
			? ["environmentVariables", "packageArguments", "runtimeArguments"]
			: ["headers"]),
	];
	if (
		keys.some((key) => key in entry) ||
		(transport.success &&
			Object.keys(transport.data).some((key) => key !== "type"))
	)
		return blocked();
	const fields = fieldsOf(
		remote ? entry.headers : entry.environmentVariables,
		remote ? "header" : "env",
	);
	if (remote) return fields;
	const args = argumentsOf(entry);
	return {
		fields: fields.fields,
		notes: [...fields.notes, ...args.notes],
		blocked: fields.blocked || args.blocked,
	};
};

const runnableOf = (s: z.output<typeof Envelope>["server"]) =>
	OfficialServerSchema.safeParse({
		server: {
			...s,
			packages: s.packages.map((p) => ({
				...p,
				environmentVariables: [],
				packageArguments: [],
			})),
			remotes: s.remotes.map((r) => ({ ...r, headers: [] })),
		},
	});

const finish = (draft: Install, source: string, requirements: Requirements) => {
	const result = RegistrySetupResultSchema.safeParse({
		...draft,
		server: {
			...draft.server,
			...(requirements.fields.length
				? { credentialFields: requirements.fields }
				: {}),
		},
		source,
		...requirements,
	});
	if (result.success) return ok(result.data);
	const fallback = RegistrySetupResultSchema.safeParse({
		...draft,
		source,
		...blocked(),
		notes: [...requirements.notes, unsupported],
	});
	return fallback.success ? ok(fallback.data) : bad();
};

/** Preserve the legacy runnable choice while refusing lossy setup metadata. */
export const setupOf = (
	raw: unknown,
	source: string,
): Result<RegistrySetupResult, ToolError> => {
	const envelope = Envelope.safeParse(raw);
	if (!envelope.success) return bad();
	const s = envelope.data.server;
	// Read only the runnable shape here; malformed requirements become a blocked draft below.
	const base = runnableOf(s);
	if (!base.success) return bad();
	const index = base.data.server.packages.findIndex(
		(p) =>
			(p.registryType === "npm" || p.registryType === "pypi") &&
			(p.transport?.type ?? "stdio") === "stdio",
	);
	const remote = index < 0;
	const entry = remote ? s.remotes[0] : s.packages[index];
	if (!entry || !safeTarget(entry, remote)) return bad();
	const draft = installOf(base.data.server);
	if (typeof draft === "string") return bad();
	const requirements = ["variables", "authentication", "auth"].some(
		(key) => key in s,
	)
		? blocked()
		: requirementsOf(entry, remote);
	return finish(draft, source, requirements);
};
