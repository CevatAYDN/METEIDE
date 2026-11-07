import {
	ContextAttachmentsSchema,
	type ContextSnapshot,
} from "@mete/contracts";
import type {
	ContextReceipt,
	InitialContextReceipt,
} from "./context-receipt.js";
import { createSendIntent } from "./send-intent.js";

/** Workspace/conversation-scoped identity; unsent initial conversations have a separate scope. */
export const contextScope = (dir: string, conversationId?: string) =>
	JSON.stringify([dir, conversationId ?? null]);
/** A panel target has process-local identity in addition to its persistent conversation scope. */
export type ContextTarget = { readonly dir: string; readonly scope: string };
/** The source URI stays separate from the server's canonical preview path. */
export type ContextAttachment = {
	readonly id: string;
	readonly snapshot: ContextSnapshot;
	readonly sourcePath: string;
};
/** Controlled authored text retained independently of mounted React forms. */
export type MessageDraft = {
	readonly value: string;
	readonly busy: boolean;
	readonly onChange: (message: string) => void;
};
type Draft = {
	readonly message: string;
	readonly attachments: readonly ContextAttachment[];
	readonly revision: number;
	readonly busy: boolean;
	readonly error?: string | undefined;
};
type Ticket = {
	scope: string;
	epoch: number;
	revision: number;
	id?: string | undefined;
};
const empty: Draft = Object.freeze({
	message: "",
	attachments: Object.freeze([]),
	revision: 0,
	busy: false,
});
const copy = (snapshot: ContextSnapshot): ContextSnapshot => {
	const range = snapshot.range
		? Object.freeze({
				start: Object.freeze({ ...snapshot.range.start }),
				end: Object.freeze({ ...snapshot.range.end }),
			})
		: undefined;
	return Object.freeze({ ...snapshot, ...(range ? { range } : {}) });
};
const replaceAttachment = (
	items: readonly ContextAttachment[],
	item: ContextAttachment | undefined,
	id?: string,
) => {
	if (!item) return items;
	return id
		? items.map((previous) => (previous.id === id ? item : previous))
		: [...items, item];
};
const sameSnapshot = (left: ContextSnapshot, right: ContextSnapshot) =>
	left.path === right.path &&
	left.content === right.content &&
	left.modified === right.modified &&
	left.sha256 === right.sha256 &&
	left.range?.start.line === right.range?.start.line &&
	left.range?.start.character === right.range?.start.character &&
	left.range?.end.line === right.range?.end.line &&
	left.range?.end.character === right.range?.end.character;
const sameAttachments = (
	left: readonly ContextAttachment[],
	right: readonly ContextAttachment[],
) =>
	left.length === right.length &&
	left.every((item, index) => {
		const other = right[index];
		return !!other && sameSnapshot(item.snapshot, other.snapshot);
	});
const attachmentOf = (
	value: Omit<ContextAttachment, "id"> | undefined,
	id?: string,
) =>
	value
		? Object.freeze({
				...value,
				id: id ?? crypto.randomUUID(),
				snapshot: copy(value.snapshot),
			})
		: undefined;

/** Owns transient drafts and exact retry receipts without persisting editor buffers. */
export class DraftStore {
	readonly intents = createSendIntent();
	readonly receipts = new Map<string, ContextReceipt>();
	readonly initialReceipts = new Map<string, InitialContextReceipt>();
	private readonly entries = new Map<string, Draft>();
	private readonly preparations = new Map<string, Ticket>();
	private selected: string | undefined;
	private epoch = 0;
	constructor(private readonly onChange: () => void) {}
	readonly read = (scope: string) => this.entries.get(scope) ?? empty;
	private set(scope: string, next: Draft) {
		this.entries.set(scope, Object.freeze(next));
		this.onChange();
	}
	private edit(scope: string, next: Partial<Draft>) {
		const old = this.read(scope);
		if (!old.busy)
			this.set(scope, {
				...old,
				...next,
				revision:
					old.revision +
					Number(
						(next.message ?? old.message) !== old.message ||
							!sameAttachments(
								next.attachments ?? old.attachments,
								old.attachments,
							),
					),
				error: undefined,
			});
	}
	readonly complete = (
		ticket: Ticket,
		value?: Omit<ContextAttachment, "id">,
		error?: string,
	) => {
		const old = this.read(ticket.scope);
		if (this.preparations.get(ticket.scope) !== ticket) return false;
		this.preparations.delete(ticket.scope);
		if (ticket.revision !== old.revision) return false;
		const current =
			ticket.epoch === this.epoch && ticket.scope === this.selected;
		const item = attachmentOf(value, ticket.id);
		const attachments = replaceAttachment(old.attachments, item, ticket.id);
		const valid = ContextAttachmentsSchema.safeParse(
			attachments.map((entry) => entry.snapshot),
		).success;
		const accepted = current && !!item && valid;
		this.set(ticket.scope, {
			...old,
			busy: false,
			attachments: accepted ? Object.freeze(attachments) : old.attachments,
			revision:
				old.revision +
				Number(accepted && !sameAttachments(attachments, old.attachments)),
			error: !current ? old.error : accepted ? undefined : error,
		});
		return accepted;
	};
	readonly select = (scope: string | undefined) => {
		if (scope !== this.selected) this.epoch++;
		this.selected = scope;
	};
	readonly message = (scope: string, message: string) =>
		this.edit(scope, { message });
	readonly remove = (scope: string, id: string) =>
		this.edit(scope, {
			attachments: Object.freeze(
				this.read(scope).attachments.filter((entry) => entry.id !== id),
			),
		});
	readonly error = (scope: string, error: string) => {
		this.set(scope, { ...this.read(scope), error });
	};
	readonly prepare = (scope: string, id?: string): Ticket | undefined => {
		const old = this.read(scope);
		if (scope !== this.selected || old.busy) return undefined;
		const ticket = { scope, epoch: this.epoch, revision: old.revision, id };
		this.preparations.set(scope, ticket);
		this.set(scope, { ...old, busy: true, error: undefined });
		return ticket;
	};
	readonly lock = (scope: string) => {
		const old = this.read(scope);
		if (old.busy) return undefined;
		this.set(scope, { ...old, busy: true });
		return {
			revision: old.revision,
			attachments: old.attachments.map((entry) => copy(entry.snapshot)),
		};
	};
	readonly finish = (scope: string, revision: number, success: boolean) => {
		const old = this.read(scope);
		if (old.revision !== revision) return;
		if (success) this.initialReceipts.delete(scope);
		this.set(
			scope,
			success ? { ...empty, revision: revision + 1 } : { ...old, busy: false },
		);
	};
}

/** In-memory drafts retain no raw pre-mask text; all edit/send authority is scoped (ADR-183). */
export const createContextDrafts = (onChange: () => void) =>
	new DraftStore(onChange);

/** Draft storage port shared by the initial and reply composers, never persisted. */
export type ContextDrafts = ReturnType<typeof createContextDrafts>;
