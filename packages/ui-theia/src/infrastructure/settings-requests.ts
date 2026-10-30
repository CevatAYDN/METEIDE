import {
	DAEMON_METHODS,
	DaemonMcpTestResultSchema,
	DaemonProviderModelsResultSchema,
	DaemonProviderTestResultSchema,
	DaemonSettingsResultSchema,
	type Result,
} from "@mete/contracts";
import type { DaemonFailure } from "../domain/status-service.js";

// The Settings screen's requests: what the daemon loaded (ADR-081), a custom endpoint's models and
// Test (ADR-087), and an MCP server's Test (ADR-164).

/** A protocol schema's safeParse answer. */
export type Parsed<T> =
	| { readonly success: true; readonly data: T }
	| { readonly success: false; readonly error: { readonly message: string } };

/** One request to the folder's daemon, its answer parsed with the protocol schema. */
export type Send = <T>(
	dir: string,
	method: string,
	params: object,
	parse: (raw: unknown) => Parsed<T>,
) => Promise<Result<T, DaemonFailure>>;

export const settingsRequests = (send: Send) => ({
	settings: (dir: string) =>
		send(dir, DAEMON_METHODS.settings, {}, (raw) =>
			DaemonSettingsResultSchema.safeParse(raw),
		),
	providerModels: (dir: string, providerId: string) =>
		send(dir, DAEMON_METHODS.providerModels, { providerId }, (raw) =>
			DaemonProviderModelsResultSchema.safeParse(raw),
		),
	providerTest: (dir: string, providerId: string, models: readonly string[]) =>
		send(dir, DAEMON_METHODS.providerTest, { providerId, models }, (raw) =>
			DaemonProviderTestResultSchema.safeParse(raw),
		),
	mcpTest: (dir: string, id: string) =>
		send(dir, DAEMON_METHODS.mcpTest, { id }, (raw) =>
			DaemonMcpTestResultSchema.safeParse(raw),
		),
});
