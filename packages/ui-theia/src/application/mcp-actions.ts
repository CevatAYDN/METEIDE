import type { Result } from "@mete/contracts";
import type { McpDraft, McpServerDraft } from "./mcp-draft.js";

export type McpTextField = Exclude<keyof McpServerDraft, "permissions">;

/** Shared UI intent ports; nested fields do not import their parent view. */
export type McpActions = {
	readonly onField: (index: number, key: McpTextField, value: string) => void;
	readonly onPermission: (
		index: number,
		permission: string,
		on: boolean,
	) => void;
	readonly onAdd: () => void;
	readonly onRemove: (index: number) => void;
	readonly onAddDraft?:
		| ((drafts: McpDraft) => Result<McpDraft, string>)
		| undefined;
	readonly onSaveConnect?: ((id: string) => void) | undefined;
	readonly onConnect?: ((id: string) => void) | undefined;
	readonly onCatalog?: (() => void) | undefined;
};
