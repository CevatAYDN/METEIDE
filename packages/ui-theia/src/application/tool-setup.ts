import {
	err,
	McpConfigSchema,
	McpServerSchema,
	ok,
	type Result,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { z } from "zod";
import {
	EMPTY_MCP_SERVER,
	type McpDraft,
	type McpServerDraft,
	serverDraftOf,
} from "./mcp-draft.js";

/** Separate guided input; changing or cancelling it never changes the saved form. */
export type ToolSetup = {
	readonly mode: "remote" | "local" | "import";
	readonly id?: string;
	readonly url?: string;
	readonly httpMode?: string;
	readonly command?: string;
	readonly args?: string;
	readonly runtime?: string;
	readonly json?: string;
};

/** A safe, localizable refusal associated with its input. */
export type ToolSetupError = {
	readonly code: "invalid_setup";
	readonly field: string;
	readonly text: string;
};

const fail = (field: string, text: string): Result<never, ToolSetupError> =>
	err({ code: "invalid_setup", field, text });
const invalid = () =>
	nls.localize(
		"mete/tools/invalid",
		"Check the server id and required fields. Unsupported fields cannot be imported.",
	);
const credentials = () =>
	nls.localize(
		"mete/tools/credentials",
		"Credentials and environment values need advanced setup; remove them before importing.",
	);
const runtimeNeeded = () =>
	nls.localize(
		"mete/tools/runtimeNeeded",
		"Choose a runtime for this program. Only npx and uvx are detected automatically.",
	);
const httpNeeded = () =>
	nls.localize(
		"mete/tools/httpNeeded",
		"Choose Streamable HTTP or SSE explicitly.",
	);
const runtimeOf = (command: string) =>
	command === "npx" ? "node" : command === "uvx" ? "python" : "";
const secretFlag = /(?:token|secret|password|api[-_]?key|authorization)/i;
const argsSchema = z.array(
	z
		.string()
		.min(1)
		.refine((arg) => !/[\r\n\0]/.test(arg)),
);
const local = z.strictObject({
	command: z.string().min(1),
	args: argsSchema.optional(),
	env: z.record(z.string(), z.string()).optional(),
});
const remote = z.strictObject({
	url: z.url({ protocol: /^https?$/ }),
	type: z.enum(["http", "streamable-http", "sse"]).optional(),
});
const external = z.strictObject({
	mcpServers: z.record(z.string(), z.union([local, remote])),
});

const safeUrl = (value: string) => {
	const parsed = z.url({ protocol: /^https?$/ }).safeParse(value);
	if (!parsed.success) return false;
	const url = new URL(parsed.data);
	return (
		!url.username &&
		!url.password &&
		!url.search &&
		!url.hash &&
		!secretFlag.test(url.pathname)
	);
};

const safeImport = (row: McpServerDraft) =>
	!row.env &&
	!secretFlag.test(row.args) &&
	((row.transport === "stdio" && row.runtime !== "binary") || safeUrl(row.url));

// Keep raw optional omissions: schema outputs include defaults which the user did not set.
const validated = (servers: unknown): Result<McpDraft, ToolSetupError> => {
	const checked = McpConfigSchema.safeParse({ servers });
	if (!checked.success || !Array.isArray(servers) || servers.length === 0)
		return fail("json", invalid());
	if (
		checked.data.servers.some(
			(server) =>
				server.transport === "stdio" &&
				!argsSchema.safeParse(server.args).success,
		)
	)
		return fail(
			"json",
			nls.localize(
				"mete/tools/argsInvalid",
				"Each argument must be a non-empty single line. Use advanced setup for other values.",
			),
		);
	const drafts = servers.map(serverDraftOf);
	return drafts.every(safeImport) ? ok(drafts) : fail("json", credentials());
};

const externalRows = (
	input: z.output<typeof external>,
	httpMode: string | undefined,
): Result<unknown[], ToolSetupError> => {
	const servers: unknown[] = [];
	for (const [id, entry] of Object.entries(input.mcpServers)) {
		const result = externalServer(id, entry, httpMode);
		if (!result.ok) return result;
		servers.push(result.value);
	}
	return ok(servers);
};

const externalServer = (
	id: string,
	entry: z.output<typeof local> | z.output<typeof remote>,
	httpMode: string | undefined,
): Result<unknown, ToolSetupError> => {
	if ("command" in entry) return importedLocal(id, entry);
	const type = entry.type ?? httpMode;
	if (!type || !["http", "streamable-http", "sse"].includes(type))
		return fail("httpMode", httpNeeded());
	return ok({
		id,
		transport: type === "http" ? "streamable-http" : type,
		url: entry.url,
	});
};

const importedLocal = (
	id: string,
	entry: z.output<typeof local>,
): Result<unknown, ToolSetupError> => {
	const runtime = runtimeOf(entry.command);
	if (!runtime) return fail("json", runtimeNeeded());
	if (entry.env && Object.keys(entry.env).length)
		return fail("json", credentials());
	return ok({
		id,
		transport: "stdio",
		runtime,
		command: entry.command,
		...(entry.args ? { args: entry.args } : {}),
	});
};

/** Imports only lossless, credential-free strict external maps or METE server lists. */
export const importTools = (
	text: string,
	httpMode?: string,
): Result<McpDraft, ToolSetupError> => {
	let input: unknown;
	try {
		input = JSON.parse(text);
	} catch {
		return fail(
			"json",
			nls.localize("mete/tools/jsonInvalid", "Enter valid JSON."),
		);
	}
	const native = McpConfigSchema.safeParse(input);
	if (native.success) {
		const raw = z
			.strictObject({ servers: z.array(z.unknown()).min(1) })
			.safeParse(input);
		return raw.success ? validated(raw.data.servers) : fail("json", invalid());
	}
	const parsed = external.safeParse(input);
	if (!parsed.success) return fail("json", invalid());
	const rows = externalRows(parsed.data, httpMode);
	return rows.ok ? validated(rows.value) : rows;
};

/** Validates a guided addition without shell tokenization or implicit HTTP selection. */
export const prepareTool = (
	input: ToolSetup,
): Result<McpDraft, ToolSetupError> => {
	if (input.mode === "import")
		return importTools(input.json ?? "", input.httpMode);
	const id = input.id?.trim() ?? "";
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return fail("id", invalid());
	return input.mode === "remote"
		? prepareRemote(input, id)
		: prepareLocal(input, id);
};

const prepareRemote = (
	input: ToolSetup,
	id: string,
): Result<McpDraft, ToolSetupError> => {
	if (!["streamable-http", "sse"].includes(input.httpMode ?? ""))
		return fail("httpMode", httpNeeded());
	if (!safeUrl(input.url?.trim() ?? ""))
		return fail(
			"url",
			nls.localize(
				"mete/tools/urlInvalid",
				"Enter an HTTP or HTTPS address without credentials or query parameters.",
			),
		);
	return checkedDraft({
		...EMPTY_MCP_SERVER,
		id,
		transport: input.httpMode ?? "",
		url: input.url?.trim() ?? "",
	});
};

const prepareLocal = (
	input: ToolSetup,
	id: string,
): Result<McpDraft, ToolSetupError> => {
	const command = input.command?.trim() ?? "";
	if (!command || /[\r\n\0]/.test(command)) return fail("command", invalid());
	const runtime = runtimeOf(command) || input.runtime || "";
	if (!runtime) return fail("runtime", runtimeNeeded());
	return checkedDraft({
		...EMPTY_MCP_SERVER,
		id,
		transport: "stdio",
		runtime,
		command,
		args: input.args ?? "",
	});
};

const checkedDraft = (
	row: McpServerDraft,
): Result<McpDraft, ToolSetupError> => {
	const server =
		row.transport === "stdio"
			? {
					id: row.id,
					transport: row.transport,
					runtime: row.runtime,
					command: row.command,
					args: row.args ? row.args.split("\n") : [],
				}
			: { id: row.id, transport: row.transport, url: row.url };
	return McpServerSchema.safeParse(server).success
		? ok([row])
		: fail(row.transport === "stdio" ? "runtime" : "url", invalid());
};
