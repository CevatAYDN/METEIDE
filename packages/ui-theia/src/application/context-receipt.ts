import type {
	ConversationCapability,
	SkillPolicy,
	ThreadContextReplyInput,
	ThreadContextStartInput,
	ThreadReplyInput,
	ThreadSkillsReplyInput,
	ThreadSkillsStartInput,
	ThreadStartInput,
} from "@mete/contracts";

/** An uncertain reply retains its exact immutable payload, even after the panel is reopened. */
export type ContextReceipt = {
	readonly input:
		| ThreadReplyInput
		| ThreadContextReplyInput
		| ThreadSkillsReplyInput;
	readonly title: string;
	readonly selection: readonly ConversationCapability[] | undefined;
	readonly skills?: SkillPolicy | undefined;
	readonly sessionId?: string | undefined;
	readonly draftScope: string;
	readonly context: boolean;
	readonly revision: number;
};

/** Initial admission retains model/tools and the UUID as well as the ordered snapshots. */
export type InitialContextReceipt = {
	readonly input:
		| ThreadStartInput
		| ThreadContextStartInput
		| ThreadSkillsStartInput;
	readonly sessionId?: string | undefined;
	readonly context: boolean;
	readonly revision: number;
};
