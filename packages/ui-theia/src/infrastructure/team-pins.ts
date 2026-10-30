import { NeedSchema, TierSchema } from "@mete/contracts";
import type { MessageService } from "@theia/core";
import { nls } from "@theia/core/lib/common/nls";
import type URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type PickerFacts, pickerFacts } from "../application/composer.js";
import {
	chainKey,
	isEmpty,
	type PinsDraft,
	pinsIssue,
	pinsOf,
	pinsOfTeam,
	withPin,
} from "../application/pins-draft.js";
import type { TeamView } from "../application/team-draft.js";
import type { MeteDaemonService } from "../domain/status-service.js";

// What the team editor keeps of the folder's pins (ADR-077): the file .mete/pins.yaml, read when a
// team opens, and the models each tier would try, which a pin's field offers. A pin is the folder's
// own setting: it is written at once, never with the team's Save, and a file left with no pin is deleted.

type Deps = {
	readonly files: FileService;
	readonly messages: MessageService;
	readonly daemon: MeteDaemonService;
};

/** The folder's pins file and the tiers' model lists, for one team editor. */
export class TeamPins {
	/** The folder's pins file; undefined while it does not parse, so it is never written over. */
	protected pins: PinsDraft | undefined;
	protected error: string | undefined;
	/** Each tier's chain for the pin's suggestions, fetched once per tier and needs. */
	readonly chains = new Map<string, readonly string[]>();
	/** The chains' facts and the providers' states, asked again each time a new chain came (ADR-161). */
	picker: PickerFacts | undefined;

	constructor(protected readonly deps: Deps) {}

	protected file(root: URI): URI {
		return root.resolve(".mete/pins.yaml");
	}

	async read(root: URI): Promise<void> {
		const { files } = this.deps;
		const file = this.file(root);
		try {
			const text = (await files.exists(file))
				? (await files.read(file)).value
				: undefined;
			const r = pinsOf(text);
			this.pins = r.ok ? r.value : undefined;
			this.error = r.ok ? undefined : r.error;
		} catch (e) {
			this.pins = undefined;
			this.error = String(e);
		}
	}

	/** This team's pins, by member id. */
	of(teamId: string): Readonly<Record<string, string>> {
		return this.pins ? pinsOfTeam(this.pins, teamId) : {};
	}

	/** The models each member's tier would try, asked once per tier and needs; a failed ask offers none. Whether a list came. */
	async fetchChains(root: URI, team: TeamView): Promise<boolean> {
		let fetched = false;
		for (const r of team.roles) {
			const key = chainKey(r.tier, r.needs);
			const tier = TierSchema.safeParse(r.tier);
			if (this.chains.has(key) || !tier.success) continue;
			this.chains.set(key, []);
			const needs = NeedSchema.array().parse(
				r.needs.filter((n) => NeedSchema.safeParse(n).success),
			);
			const got = await this.deps.daemon.chain(
				root.path.fsPath(),
				tier.data,
				needs,
			);
			if (!got.ok) continue;
			this.chains.set(
				key,
				got.value.models.map((m) => `${m.providerId}/${m.modelId}`),
			);
			fetched = true;
		}
		if (fetched)
			this.picker = await pickerFacts(
				this.deps.daemon,
				root.path.fsPath(),
				[...this.chains.values()].flat(),
			);
		return fetched;
	}

	/** Pins or unpins a member's model; the team's pins after it, or undefined when nothing was written. */
	async set(
		root: URI,
		teamId: string,
		roleId: string,
		value: string | undefined,
	): Promise<Readonly<Record<string, string>> | undefined> {
		const { files, messages } = this.deps;
		if (!this.pins)
			return void messages.warn(
				nls.localize(
					"mete/team/pinsUnreadable",
					"METE cannot read .mete/pins.yaml, so it does not change it: {0}",
					this.error ?? "",
				),
			);
		const next = withPin(this.pins, teamId, roleId, value);
		const issue = pinsIssue(next);
		if (issue)
			return void messages.warn(
				nls.localize(
					"mete/team/pinRefused",
					"This pin is not saved: {0}",
					issue,
				),
			);
		const file = this.file(root);
		try {
			if (!isEmpty(next)) await files.write(file, next.toString());
			else if (await files.exists(file)) await files.delete(file);
		} catch (e) {
			return void messages.error(
				nls.localize(
					"mete/team/pinNotSaved",
					"METE could not save the pin: {0}",
					String(e),
				),
			);
		}
		this.pins = next;
		return pinsOfTeam(next, teamId);
	}
}
