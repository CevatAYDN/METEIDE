import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	McpConfigSchema,
	McpCredentialWriteSchema,
	type SecretStore,
} from "@mete/contracts";
import { loadConfig } from "@mete/kernel";
import { writeMcpCredentials } from "@mete/mcp";
import { createKeychainStore } from "@mete/security";
import type { AppOptions } from "../infrastructure/app.js";
import { runLockFile, takeRunLock } from "../infrastructure/run-lock.js";
import type { Io } from "./commands.js";

/** The standalone command takes the same exclusive workspace lock as the daemon. */
export const mcpKeyCommand = async (
	options: AppOptions,
	io: Io,
	args: readonly string[],
) => {
	if (args[0] !== "set" || args.length !== 2 || !args[1]) {
		io.err("usage: mete mcp-key set <folder> (JSON on stdin)");
		return 1;
	}
	const workspaceDir = resolve(options.workspaceDir, args[1]);
	const lock = await takeRunLock(runLockFile(workspaceDir));
	if (!lock.ok) {
		io.err("Work is active; retry credential setup when idle");
		return 1;
	}
	try {
		return await mcpCredentialCommand(
			{
				workspaceDir,
				globalDir: options.globalDir,
				secrets: options.secrets ?? createKeychainStore(),
			},
			io,
		);
	} finally {
		await lock.value();
	}
};

/** Explicit user CLI command; the caller must hold the workspace's run lock. */
export const mcpCredentialCommand = async (
	options: {
		readonly workspaceDir: string;
		readonly globalDir: string;
		readonly secrets: SecretStore;
	},
	io: Io,
) => {
	let raw: unknown;
	try {
		raw = JSON.parse((await io.readSecret("")) ?? "");
	} catch {
		io.err("Invalid MCP credential input");
		return 1;
	}
	const input = McpCredentialWriteSchema.safeParse(raw);
	if (!input.success) {
		io.err("Invalid MCP credential fields");
		return 1;
	}
	const config = await loadConfig(options);
	if (!config.ok) {
		io.err("MCP configuration could not be loaded");
		return 1;
	}
	const loaded = config.value.reader.get("mcp", McpConfigSchema);
	if (
		!loaded.ok ||
		!isDeepStrictEqual(
			loaded.value.servers.find(
				(server) => server.id === input.data.expected.id,
			),
			input.data.expected,
		)
	) {
		io.err(
			"The saved MCP configuration changed; refresh before saving credentials",
		);
		return 1;
	}
	const result = await writeMcpCredentials(
		options,
		input.data,
		new AbortController().signal,
	);
	if (!result.ok) {
		io.err("MCP credentials could not be saved");
		return 1;
	}
	io.out("MCP credentials saved in the keychain");
	return 0;
};
