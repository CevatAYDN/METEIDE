import type { SecretStore } from "@mete/contracts";
import { apiKeyName } from "@mete/providers";
import { searchKeyName } from "@mete/tools";
import type { Io } from "./commands.js";

// `mete key`: provider and search keys in the keychain, never on the command line (ARCHITECTURE.md, CLI).

const PROVIDER =
	/^(nvidia|openrouter|opencode-zen|groq|google|tavily|custom:[a-z0-9]+(-[a-z0-9]+)*)$/;
// Each provider's kind and the page where the user gets a key (docs/09, Key pages; ADR-088).
const BUILT_IN = [
	["nvidia", "model", "https://build.nvidia.com/settings/api-keys"],
	["openrouter", "model", "https://openrouter.ai/keys"],
	["opencode-zen", "model", "https://opencode.ai/console"],
	["groq", "model", "https://console.groq.com/keys"],
	["google", "model", "https://aistudio.google.com/app/apikey"],
	["tavily", "search", "https://app.tavily.com"],
] as const;
const SEARCH = new Set(["tavily"]);

// Model providers keep providers/<id>/apiKey, search providers search/<id>/apiKey (docs/09, docs/10).
const accountOf = (id: string) =>
	SEARCH.has(id) ? searchKeyName(id) : apiKeyName(id);

const listKeys = async (secrets: SecretStore, io: Io) => {
	for (const [id, kind, page] of BUILT_IN) {
		const r = await secrets.get(accountOf(id));
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		const state = r.value ? "key set" : "no key";
		io.out(`${id.padEnd(14)} ${state.padEnd(8)} ${kind.padEnd(7)} ${page}`);
	}
	return 0;
};

/** `mete key set|delete <provider id>` and `mete key list`; a key never comes from argv. */
export const keyCommand = async (
	secrets: SecretStore,
	io: Io,
	action: string | undefined,
	provider: string | undefined,
) => {
	if (action === "list") return listKeys(secrets, io);
	const valid = provider !== undefined && PROVIDER.test(provider);
	if (valid && action === "set") return setKey(secrets, io, provider);
	if (valid && action === "delete") return deleteKey(secrets, io, provider);
	io.err(
		"usage: mete key set|delete <nvidia|openrouter|opencode-zen|groq|google|tavily|custom:<slug>>, mete key list",
	);
	return 1;
};

const setKey = async (secrets: SecretStore, io: Io, provider: string) => {
	const key = await io.readSecret(`${provider} API key: `);
	if (!key) {
		io.err("no key entered");
		return 1;
	}
	const r = await secrets.set(accountOf(provider), key);
	io.out(r.ok ? `${provider} key saved in the keychain` : r.error.message);
	return r.ok ? 0 : 1;
};

const deleteKey = async (secrets: SecretStore, io: Io, provider: string) => {
	const r = await secrets.delete(accountOf(provider));
	if (!r.ok) io.out(r.error.message);
	else io.out(r.value ? `${provider} key deleted` : `${provider} had no key`);
	return r.ok ? 0 : 1;
};
