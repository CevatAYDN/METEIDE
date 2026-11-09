import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { toNamespacedPath } from "node:path";
import { withLockRetry } from "@mete/kernel";

/** Canonical workspace binding shared by grants and receipts; never exposed to callers. */
export const skillWorkspaceKey = async (
	workspaceDir: string,
	workspaceId: string,
): Promise<string> => {
	const root = await withLockRetry(() => realpath(workspaceDir));
	const canonical =
		process.platform === "win32" ? toNamespacedPath(root).toLowerCase() : root;
	return createHash("sha256")
		.update(JSON.stringify([canonical, workspaceId]))
		.digest("hex");
};
