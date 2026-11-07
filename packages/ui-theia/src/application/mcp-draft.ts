import {
	err,
	McpConfigSchema,
	McpServerSchema,
	ok,
	PermissionSchema,
	type Result,
} from "@mete/contracts";
import { isMap, isSeq, parseDocument, type YAMLMap } from "yaml";
import { type Target, valueAt } from "./section-draft.js";
import {
	type Doc,
	dropSection,
	isEmpty,
	issueText,
	reasonOf,
	sectionOf,
} from "./yaml-section.js";

// The MCP servers card's file (ADR-097): .mete/mcp.yaml holds `servers`, and the global settings.yaml
// holds the same list under `mcp`. A server is a local process (stdio) or a remote one (http or sse),
// so a row keeps the fields of both shapes and Save writes only the ones the chosen shape uses.

/** One server as the user typed it; a field the shape does not use is kept, not written. */
export type McpServerDraft = {
	readonly id: string;
	readonly transport: string;
	readonly runtime: string;
	readonly command: string;
	/** One argument per line, since an argument may hold spaces or commas. */
	readonly args: string;
	/** One Name=value per line. */
	readonly env: string;
	readonly url: string;
	readonly sha256: string;
	readonly auth: string;
	readonly permissions: readonly string[];
	/** Metadata remains intact until the server schema validates it; no values belong here. */
	readonly credentialFields?: unknown;
};

/** What the card edits. */
export type McpDraft = readonly McpServerDraft[];

/** An empty advanced row, also used to initialize a guided draft. */
export const EMPTY_MCP_SERVER: McpServerDraft = {
	id: "",
	transport: "",
	runtime: "",
	command: "",
	args: "",
	env: "",
	url: "",
	sha256: "",
	auth: "",
	permissions: [],
};

/** The transports of `McpServerSchema` (docs/10). */
export const TRANSPORTS = ["stdio", "streamable-http", "sse"] as const;

/** A stdio server's runtime, which `runtime.ensure@1` prepares (docs/10). */
export const RUNTIMES = ["node", "python", "binary", "container"] as const;

/** A remote server's sign-in. */
export const AUTHS = ["none", "oauth"] as const;

/** The permissions a server may ask, from the contract's own list. */
export const PERMISSIONS = PermissionSchema.options;

const prefixOf = (target: Target) => (target === "global" ? ["mcp"] : []);

const text = (value: unknown) => (typeof value === "string" ? value : "");

const mapOf = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

/** Converts validated server input without materializing omitted contract defaults. */
export const serverDraftOf = (item: unknown): McpServerDraft => {
	const server = mapOf(item);
	const env = mapOf(server.env);
	return {
		id: text(server.id),
		transport: text(server.transport),
		runtime: text(server.runtime),
		command: text(server.command),
		args: Array.isArray(server.args) ? server.args.map(String).join("\n") : "",
		env: Object.entries(env)
			.map(([key, value]) => `${key}=${String(value)}`)
			.join("\n"),
		url: text(server.url),
		sha256: text(server.sha256),
		auth: text(server.auth),
		permissions: Array.isArray(server.permissions)
			? server.permissions.map(String)
			: [],
		...("credentialFields" in server
			? { credentialFields: server.credentialFields }
			: {}),
	};
};

/** The servers a file sets; a missing file sets none. */
export const serversOf = (
	text: string | undefined,
	target: Target,
): Result<McpDraft, string> => {
	const doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const list = valueAt(doc.toJS(), [...prefixOf(target), "servers"]);
	if (list === undefined || list === null) return ok([]);
	if (!Array.isArray(list)) return err("servers: expected a list of servers");
	return ok(list.map(serverDraftOf));
};

// A row's name in a refusal: its id, or its place in the list while the id is typed.
const nameOf = (draft: McpServerDraft, index: number) =>
	draft.id.trim() || `server ${index + 1}`;

const envOf = (
	draft: McpServerDraft,
	name: string,
): Result<Record<string, string>, string> => {
	const env: Record<string, string> = {};
	for (const [i, row] of draft.env
		.split("\n")
		.filter((line) => line.trim() !== "")
		.entries()) {
		const at = row.indexOf("=");
		if (at <= 0) return err(`${name}: env line ${i + 1} needs Name=value`);
		env[row.slice(0, at).trim()] = row.slice(at + 1);
	}
	return ok(env);
};

// The keys a card sets only when the user typed something, so the file keeps no empty lists.
const withOptionals = (
	server: Record<string, unknown>,
	draft: McpServerDraft,
	env: Record<string, string>,
) => {
	const args = draft.args === "" ? [] : draft.args.split("\n");
	if (args.length > 0) server.args = args;
	if (Object.keys(env).length > 0) server.env = env;
	if (draft.permissions.length > 0) server.permissions = [...draft.permissions];
};

// A binary server names its download; no other runtime has one.
const withDownload = (
	server: Record<string, unknown>,
	draft: McpServerDraft,
) => {
	if (draft.runtime !== "binary") return;
	const url = draft.url.trim();
	const sha256 = draft.sha256.trim();
	if (url !== "") server.url = url;
	if (sha256 !== "") server.sha256 = sha256;
};

const stdioOf = (
	draft: McpServerDraft,
	id: string,
	name: string,
): Result<Record<string, unknown>, string> => {
	if (draft.runtime === "") return err(`${name}: choose a runtime`);
	const command = draft.command.trim();
	if (command === "") return err(`${name}: a local server needs a command`);
	const env = envOf(draft, name);
	if (!env.ok) return env;
	const server: Record<string, unknown> = {
		id,
		transport: "stdio",
		runtime: draft.runtime,
		command,
	};
	withOptionals(server, draft, env.value);
	withDownload(server, draft);
	return ok(server);
};

const remoteOf = (
	draft: McpServerDraft,
	id: string,
	name: string,
): Result<Record<string, unknown>, string> => {
	const url = draft.url.trim();
	if (url === "") return err(`${name}: a remote server needs a URL`);
	const server: Record<string, unknown> = {
		id,
		transport: draft.transport,
		url,
	};
	if (draft.auth === "oauth") server.auth = "oauth";
	if (draft.permissions.length > 0) server.permissions = [...draft.permissions];
	return ok(server);
};

// The row as the file's server, checked with the contract's own schema.
const serverOf = (
	draft: McpServerDraft,
	index: number,
): Result<Record<string, unknown>, string> => {
	const name = nameOf(draft, index);
	const id = draft.id.trim();
	if (id === "") return err(`${name}: a server needs an id`);
	if (draft.transport === "")
		return err(`${name}: choose a transport (stdio, streamable-http or sse)`);
	const built =
		draft.transport === "stdio"
			? stdioOf(draft, id, name)
			: remoteOf(draft, id, name);
	if (!built.ok) return built;
	if (draft.credentialFields !== undefined)
		built.value.credentialFields = draft.credentialFields;
	const checked = McpServerSchema.safeParse(built.value);
	return checked.success ? built : err(`${name}: ${reasonOf(checked.error)}`);
};

/**
 * The file's new text with the servers set, or removed when the card has none; refused with the
 * schema's first issue, so nothing invalid is written.
 */
const buildServers = (
	drafts: McpDraft,
): Result<Record<string, unknown>[], string> => {
	const built: Record<string, unknown>[] = [];
	for (const [i, draft] of drafts.entries()) {
		const server = serverOf(draft, i);
		if (!server.ok) return server;
		built.push(server.value);
	}
	const checked = McpConfigSchema.safeParse({ servers: built });
	if (!checked.success) return err(issueText(checked.error, []));
	return ok(built);
};

export const serversText = (
	text: string | undefined,
	target: Target,
	drafts: McpDraft,
): Result<string, string> => {
	const doc: Doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const result = buildServers(drafts);
	if (!result.ok) return result;
	const built = result.value;
	const prefix = prefixOf(target);
	const section = sectionOf(doc, prefix, built.length > 0);
	if (!section.ok) return section;
	const at = [...prefix, "servers"];
	if (built.length > 0) updateServers(doc, at, built);
	else if (doc.hasIn(at)) doc.deleteIn(at);
	dropSection(doc, prefix, built.length);
	const retained = McpConfigSchema.safeParse(valueAt(doc.toJS(), prefix) ?? {});
	if (!retained.success) return err(issueText(retained.error, prefix));
	return ok(isEmpty(doc) ? "" : doc.toString());
};

// Reuse each named node and update only changed keys, preserving comments and omitted defaults.
const updateServers = (
	doc: Doc,
	at: readonly string[],
	built: readonly Record<string, unknown>[],
) => {
	const previous = doc.getIn(at, true);
	if (!isSeq(previous)) return doc.setIn(at, doc.createNode(built));
	const nodes = previous.items;
	const ids = new Set(built.map((server) => server.id));
	previous.items = built.map((server, index) => {
		const named = nodes.find(
			(item) => isMap(item) && item.get("id") === server.id,
		);
		const prior = nodes.length === built.length ? nodes[index] : undefined;
		const node =
			named ?? (isMap(prior) && !ids.has(prior.get("id")) ? prior : undefined);
		if (!isMap(node)) return doc.createNode(server);
		return updateServer(doc, node, server);
	});
};

const updateServer = (
	doc: Doc,
	node: YAMLMap,
	server: Record<string, unknown>,
) => {
	const old = node.toJSON() as Record<string, unknown>;
	const projected = serverOf(serverDraftOf(old), 0);
	if (
		projected.ok &&
		JSON.stringify(projected.value) === JSON.stringify(server)
	)
		return node;
	for (const key of new Set([...Object.keys(old), ...Object.keys(server)])) {
		updateField(doc, node, {
			key,
			old: old[key],
			next: server[key],
			present: key in server,
		});
	}
	return node;
};

const updateField = (
	doc: Doc,
	node: YAMLMap,
	change: { key: string; old: unknown; next: unknown; present: boolean },
) => {
	const { key, old, next, present } = change;
	if (!Object.hasOwn(EMPTY_MCP_SERVER, key) && key !== "credentialFields")
		return;
	if (JSON.stringify(old) === JSON.stringify(next)) return;
	if (!present && omittedDefault(key, old)) return;
	if (!present) node.delete(key);
	else replaceValue(doc, node, key, next);
};

const omittedDefault = (key: string, value: unknown) =>
	(key === "auth" && value === "none") ||
	(["args", "permissions"].includes(key) &&
		Array.isArray(value) &&
		value.length === 0);

const replaceValue = (doc: Doc, node: YAMLMap, key: string, input: unknown) => {
	const value = doc.createNode(input);
	const prior = node.get(key, true);
	if (prior) {
		if (prior.comment !== undefined) value.comment = prior.comment;
		if (prior.commentBefore !== undefined)
			value.commentBefore = prior.commentBefore;
	}
	node.set(key, value);
};
