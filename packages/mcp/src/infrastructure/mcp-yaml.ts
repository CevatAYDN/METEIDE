import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	err,
	McpConfigSchema,
	type McpServer,
	ok,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { isMap, isSeq, parseDocument } from "yaml";
import { BUILT_IN_SERVERS } from "../defaults.js";

// Adds one server to the workspace's .mete/mcp.yaml for `mete registry add`; comments and the other
// entries stay as they are, and nothing is written unless the whole file still passes McpConfigSchema.

const bad = (message: string) => err<ToolError>({ code: "bad_input", message });

const load = async (file: string) => {
	try {
		return await readFile(file, "utf8");
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return "";
		throw e;
	}
};

/** Appends `server` to <workspace>/.mete/mcp.yaml; the file's path, or why it was not written. */
export const addMcpServer = async (
	workspaceDir: string,
	server: McpServer,
): Promise<Result<string, ToolError>> => {
	const file = join(workspaceDir, ".mete", "mcp.yaml");
	if (BUILT_IN_SERVERS.some((b) => b.id === server.id))
		return bad(
			`${server.id} is a built-in server id; add it by hand under another id`,
		);
	const doc = parseDocument(await load(file));
	if (doc.errors.length > 0) return bad(`${file}: ${doc.errors[0]?.message}`);
	const servers = doc.get("servers");
	if (isSeq(servers)) servers.add(doc.createNode(server));
	else if (doc.contents === null || isMap(doc.contents))
		doc.set("servers", doc.createNode([server]));
	else return bad(`${file} is not a map of settings`);
	const checked = McpConfigSchema.safeParse(doc.toJS());
	if (!checked.success)
		return bad(
			`${file}: ${checked.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
		);
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await writeFile(temp, doc.toString());
	await withLockRetry(() => rename(temp, file));
	return ok(file);
};
