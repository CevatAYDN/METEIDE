import type { GroupId } from "./settings-groups.js";
import type { GroupChoice } from "./settings-view.js";

/** In-session navigation state; changing views never reloads settings drafts. */
export class SettingsNavigation {
	private group: GroupId = "models";
	private query = "";
	constructor(private readonly changed: () => void) {}

	show(group?: GroupId): void {
		if (group !== undefined) {
			this.group = group;
			this.query = "";
		}
		this.changed();
	}

	choice(): GroupChoice {
		return {
			group: this.group,
			onGroup: (group) => {
				this.group = group;
				this.changed();
			},
			search: {
				value: this.query,
				onChange: (value) => {
					this.query = value;
					this.changed();
				},
			},
		};
	}
}
