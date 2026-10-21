import {
	err,
	ok,
	type Result,
	type SecretError,
	type SecretStore,
} from "@mete/contracts";
import { AsyncEntry } from "@napi-rs/keyring";
import { KEYCHAIN_SERVICE } from "../defaults.js";

// ModuleContext.secrets on the operating system keychain (docs/09, API keys).

/** The part of a keyring entry the store uses; tests pass a fake. */
export type KeychainEntry = {
	getPassword(): Promise<string | undefined>;
	setPassword(value: string): Promise<void>;
	deleteCredential(): Promise<boolean>;
};

/** Opens the entry for a service and account. */
export type OpenEntry = (service: string, account: string) => KeychainEntry;

/** The real keychain through @napi-rs/keyring. */
export const keyringEntry: OpenEntry = (service, account) => {
	const entry = new AsyncEntry(service, account);
	return {
		getPassword: async () => (await entry.getPassword()) ?? undefined,
		setPassword: (value) => entry.setPassword(value),
		deleteCredential: () => entry.deleteCredential(),
	};
};

// The error names the operation and the cause, never the value.
const attempt = async <T>(
	what: string,
	run: () => Promise<T>,
): Promise<Result<T, SecretError>> => {
	try {
		return ok(await run());
	} catch (error) {
		const cause = error instanceof Error ? error.message : String(error);
		return err({ code: "secret_failed", message: `${what}: ${cause}` });
	}
};

/** Creates the keychain store the composition root puts in ModuleContext.secrets. */
export const createKeychainStore = (
	open: OpenEntry = keyringEntry,
): SecretStore => {
	const entry = (name: string) => open(KEYCHAIN_SERVICE, name);
	return {
		get: (name) => attempt(`read ${name}`, () => entry(name).getPassword()),
		set: (name, value) =>
			attempt(`write ${name}`, () => entry(name).setPassword(value)),
		delete: (name) =>
			attempt(`delete ${name}`, () => entry(name).deleteCredential()),
	};
};
