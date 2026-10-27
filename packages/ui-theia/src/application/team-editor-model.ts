import type { OnEdit } from "./fields.js";
import type { TeamView } from "./team-draft.js";

// The team editor's model and what its buttons do (ADR-075), shared by the view and its hero band.

/** What the screen is showing. */
export type TeamEditorModel =
	| { readonly kind: "none" }
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly text: string }
	| {
			readonly kind: "ready";
			readonly team: TeamView;
			readonly source: "workspace" | "builtIn" | "new";
			/** The member ids the file came with: those stay fixed. */
			readonly fixedIds: readonly string[];
			readonly issues: readonly string[];
			readonly busy: boolean;
			readonly changed: boolean;
			/** The member whose form shows beside the grid (ADR-093). */
			readonly selected: number;
			/** This team's pins in the folder, by member id (ADR-077). */
			readonly pins: Readonly<Record<string, string>>;
			/** `<providerId>/<modelId>` of each tier's chain, by chainKey. */
			readonly chains: Readonly<Record<string, readonly string[]>>;
			/** The selected member's model draft: busy while it runs, what it filled, a note when it failed (ADR-108). */
			readonly draft: {
				readonly busy: boolean;
				readonly filled: "both" | "goal" | "none";
				readonly note?: string;
				readonly sources: readonly string[];
			};
	  };

/** What the screen's buttons do. */
export type TeamEditorActions = {
	readonly onEdit: OnEdit;
	readonly onSelectMember: (index: number) => void;
	readonly onAddMember: () => void;
	readonly onRemoveMember: (index: number) => void;
	readonly onRenameMember: (index: number, id: string) => void;
	/** Pins a member's model in this folder, or clears it given undefined (ADR-077). */
	readonly onPin: (roleId: string, value: string | undefined) => void;
	readonly onAddTask: (roleId: string) => void;
	readonly onRemoveTask: (index: number) => void;
	/** Drafts the selected member's fields with a model (ADR-108); the answer lands for review. */
	readonly onDraft: () => void;
	readonly onSave: () => void;
	readonly onSaveAs: (id: string, name: string) => void;
	readonly onOpenYaml: () => void;
};

/** The screen once a team is ready to edit. */
export type TeamEditorReady = Extract<TeamEditorModel, { kind: "ready" }>;
