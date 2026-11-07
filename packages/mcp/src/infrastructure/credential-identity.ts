import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { normalize } from "node:path";
import {
	err,
	type McpServer,
	McpServerSchema,
	ok,
	type Result,
	type ToolError,
} from "@mete/contracts";

const canonical = (server: McpServer) =>
	server.transport === "stdio"
		? {
				...server,
				env: Object.fromEntries(Object.entries(server.env ?? {}).sort()),
				permissions: [...server.permissions].sort(),
			}
		: {
				...server,
				url: new URL(server.url).href,
				permissions: [...server.permissions].sort(),
			};

/** Exact configuration plus a resolved workspace; never the server's origin alone. */
export const credentialIdentity = async (
	workspaceDir: string,
	server: McpServer,
): Promise<Result<string, ToolError>> => {
	const parsed = McpServerSchema.safeParse(server);
	if (!parsed.success)
		return err({ code: "bad_input", message: "Invalid MCP credential target" });
	try {
		const resolved = normalize(await realpath(workspaceDir));
		const workspace =
			process.platform === "win32" ? resolved.toLowerCase() : resolved;
		return ok(
			createHash("sha256")
				.update(JSON.stringify([workspace, canonical(parsed.data)]))
				.digest("hex"),
		);
	} catch {
		return err({
			code: "io",
			message: "The credential workspace cannot be resolved",
		});
	}
};

/** No credential channel is allowed to widen an HTTP target or carry a URL secret. */
export const credentialTargetAllowed = (server: McpServer): boolean => {
	if (server.transport === "stdio") return true;
	const url = new URL(server.url);
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		!url.hash &&
		![...url.searchParams.keys()].some((key) =>
			/token|secret|password|api[-_]?key|authorization/i.test(key),
		)
	);
};

/** Names contain only a digest, never an address, environment value or token. */
export const credentialRecordName = (
	identity: string,
	kind: "oauth" | "fields",
) => `mcp/v2/${identity}/${kind}`;
