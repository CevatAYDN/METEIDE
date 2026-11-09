import type { Mcp } from "../application/settings-section.js";
import type { ToolCatalog } from "../application/tool-catalog.js";
import type { McpSettings } from "./mcp-settings.js";
import type { McpTests } from "./mcp-tests.js";

/** Retains the form-only fallback until its connection evidence services are ready. */
export const settingsMcpView = (input: {
	readonly form: Mcp | undefined;
	readonly tests: McpTests | undefined;
	readonly connections: McpSettings | undefined;
	readonly busy: boolean;
	readonly connect: (id: string) => void;
	readonly catalog: ToolCatalog | undefined;
}): Mcp | undefined => {
	const { form, tests, connections } = input;
	if (!form || !tests || !connections) return form;
	return connections.view(form, tests, {
		busy: input.busy,
		connect: input.connect,
		catalog: input.catalog,
	});
};
