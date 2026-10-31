import { describe, expect, it, vi } from "vitest";
import { scriptedChat } from "../src/infrastructure/scripted-env.js";

// A scripted variable left in the environment switches fakes on in a real app, so it is logged.

describe("scriptedChat", () => {
	it("logs each scripted variable the environment set, and gives the chat script", () => {
		const warn = vi.fn();
		const set: Record<string, string> = {
			METE_SCRIPTED_CHAT: "chat.json",
			METE_SCRIPTED_WEB: "web.json",
		};
		expect(scriptedChat({}, { warn }, (name) => set[name])).toBe("chat.json");
		expect(warn).toHaveBeenCalledWith(
			{ variables: ["METE_SCRIPTED_CHAT", "METE_SCRIPTED_WEB"] },
			"scripted answers replace the real providers, web or browser",
		);
	});

	it("names only the variables the caller did not give, and says nothing with none set", () => {
		const warn = vi.fn();
		const given = { scriptedChat: "a.json", scriptedWeb: "b.json" };
		expect(scriptedChat(given, { warn }, () => "env.json")).toBe("a.json");
		expect(warn).toHaveBeenCalledWith(
			{ variables: ["METE_SCRIPTED_BROWSER"] },
			"scripted answers replace the real providers, web or browser",
		);
		const quiet = vi.fn();
		expect(scriptedChat({}, { warn: quiet }, () => undefined)).toBeUndefined();
		expect(quiet).not.toHaveBeenCalled();
	});
});
