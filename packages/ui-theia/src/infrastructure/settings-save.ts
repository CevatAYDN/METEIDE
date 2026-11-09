import type { McpState } from "../application/mcp-card.js";
import type { McpTests } from "./mcp-tests.js";
import type { SettingsForms } from "./settings-forms.js";

/** Saves one user-click batch only while its original settings revision remains current. */
export const saveSettings = async (input: {
	readonly current: () => boolean;
	readonly forms?: Pick<SettingsForms, "saveAll"> | undefined;
	readonly bindings?: { save(): Promise<void> } | undefined;
	readonly mcp?:
		| {
				form():
					| { readonly state: Pick<McpState, "dirty" | "servers"> }
					| undefined;
				save(): Promise<boolean>;
		  }
		| undefined;
	readonly tests?: Pick<McpTests, "saved"> | undefined;
	readonly endpoints?:
		| {
				form(): { readonly state: { readonly dirty: boolean } } | undefined;
				save(): Promise<void>;
		  }
		| undefined;
}): Promise<void> => {
	if (!input.current()) return;
	await input.forms?.saveAll(input.current);
	if (!input.current()) return;
	await input.bindings?.save();
	if (!input.current()) return;
	const mcp = input.mcp?.form();
	if (mcp?.state.dirty) {
		const saved = await input.mcp?.save();
		if (!input.current()) return;
		if (saved) input.tests?.saved(mcp.state.servers);
	}
	if (!input.current()) return;
	if (input.endpoints?.form()?.state.dirty) await input.endpoints.save();
};
