import type { Logger } from "@mete/kernel";
import {
	SCRIPTED_BROWSER_ENV,
	SCRIPTED_CHAT_ENV,
	SCRIPTED_WEB_ENV,
} from "../defaults.js";

// The scripted answers (ADR-111, ADR-116, ADR-117) replace the providers, the web and the browser of a
// real app, so one that comes from the environment rather than from the caller is said in the log: a
// variable left in a user's shell would otherwise switch them on without a word.

type Given = {
	readonly scriptedChat?: string;
	readonly scriptedWeb?: string;
	readonly scriptedBrowser?: string;
};

/** The chat script, after logging each scripted variable the environment set and the caller did not. */
export const scriptedChat = (
	env: Given,
	logger: Pick<Logger, "warn">,
	read: (name: string) => string | undefined = (name) => process.env[name],
): string | undefined => {
	const fromEnv = [
		[env.scriptedChat, SCRIPTED_CHAT_ENV],
		[env.scriptedWeb, SCRIPTED_WEB_ENV],
		[env.scriptedBrowser, SCRIPTED_BROWSER_ENV],
	].flatMap(([given, name = ""]) =>
		given === undefined && read(name) ? [name] : [],
	);
	if (fromEnv.length > 0)
		logger.warn(
			{ variables: fromEnv },
			"scripted answers replace the real providers, web or browser",
		);
	return env.scriptedChat ?? read(SCRIPTED_CHAT_ENV);
};
