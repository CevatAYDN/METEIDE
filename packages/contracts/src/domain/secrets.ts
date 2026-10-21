import type { Result } from "./result.js";

// ModuleContext.secrets from docs/06 (Kernel API): the operating system keychain
// (SECURITY.md), service "mete"; account names are in docs/09 (Provider adapter).

/** The keychain could not be read or written; `message` is for logs. */
export type SecretError = {
	readonly code: "secret_failed";
	readonly message: string;
};

/** Named secrets in the keychain; the composition root builds it. */
export interface SecretStore {
	get(name: string): Promise<Result<string | undefined, SecretError>>;
	set(name: string, value: string): Promise<Result<void, SecretError>>;
	/** Resolves false when there was nothing to delete. */
	delete(name: string): Promise<Result<boolean, SecretError>>;
}
